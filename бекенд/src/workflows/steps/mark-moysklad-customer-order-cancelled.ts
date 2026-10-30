import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  isMoyskladCredentialsFailure,
  MoyskladClient,
} from "../../modules/moysklad-integration/client"
import { MOYSKLAD_INTEGRATION_MODULE } from "../../modules/moysklad-integration"
import type MoyskladIntegrationService from "../../modules/moysklad-integration/service"

export type MarkMoyskladCustomerOrderCancelledInput = {
  orderId: string
}

export async function markMoyskladCustomerOrderCancelled(
  container: Pick<MedusaContainer, "resolve">,
  input: MarkMoyskladCustomerOrderCancelledInput,
  client: MoyskladClient = new MoyskladClient()
) {
  const moyskladService = container.resolve<MoyskladIntegrationService>(
    MOYSKLAD_INTEGRATION_MODULE
  )

  const orderSync = await moyskladService.getOrderSyncStatus(input.orderId)

  if (orderSync?.cancellation_status === "synced") {
    return orderSync
  }

  // Only orders MoySklad has already confirmed as created get a cancellation
  // mark. There is no document to annotate otherwise, and T13 explicitly
  // limits cancellation propagation to previously synchronized orders.
  if (orderSync?.status !== "synced" || !orderSync.moysklad_order_id) {
    return null
  }

  try {
    const connectionConfig = await moyskladService.getConnectionConfig()

    if (!connectionConfig?.encrypted_credentials) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "MoySklad connection is not configured."
      )
    }

    await client.markCustomerOrderCancelled(
      connectionConfig.encrypted_credentials,
      orderSync.moysklad_order_id,
      `Заказ Medusa ${input.orderId} — ОТМЕНЁН`
    )

    return await moyskladService.recordCancellationAttempt({
      orderId: input.orderId,
      status: "synced",
    })
  } catch (error) {
    if (isMoyskladCredentialsFailure(error)) {
      await moyskladService.markCredentialsReentryRequired(
        error instanceof Error
          ? error.message
          : "МойСклад требует повторного ввода реквизитов."
      )
    }
    const message = error instanceof Error ? error.message : String(error)

    await moyskladService.recordCancellationAttempt({
      orderId: input.orderId,
      status: "error",
      lastError: message,
    })

    throw error
  }
}

export const markMoyskladCustomerOrderCancelledStep = createStep(
  "mark-moysklad-customer-order-cancelled",
  async (input: MarkMoyskladCustomerOrderCancelledInput, { container }) => {
    const result = await markMoyskladCustomerOrderCancelled(container, input)

    return new StepResponse(result)
  }
)
