import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import type { ILockingModule } from "@medusajs/framework/types"

import { MOYSKLAD_INTEGRATION_MODULE } from "../modules/moysklad-integration"
import {
  MoyskladClient,
  isMoyskladCredentialsFailure,
} from "../modules/moysklad-integration/client"
import type MoyskladIntegrationService from "../modules/moysklad-integration/service"
import { createMoyskladCustomerOrderWorkflow } from "./create-moysklad-customer-order"

export type CompleteMoyskladOrderFulfillmentResult =
  | { status: "created"; moysklad_demand_id: string }
  | { status: "already_created"; moysklad_demand_id: string }
  | {
      status: "skipped"
      reason: "connection_inactive" | "order_not_synced" | "unsupported_delivery_method"
    }

export async function completeMoyskladOrderFulfillment(
  container: MedusaContainer,
  orderId: string,
  client: MoyskladClient = new MoyskladClient()
): Promise<CompleteMoyskladOrderFulfillmentResult> {
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)

  return locking.execute(`moysklad-order-fulfillment:${orderId}`, async () => {
    const service = container.resolve<MoyskladIntegrationService>(MOYSKLAD_INTEGRATION_MODULE)
    const config = await service.getConnectionConfig()
    if (!config?.is_active || config.credentials_status === "needs_reentry") {
      return { status: "skipped", reason: "connection_inactive" }
    }
    if (!config.encrypted_credentials) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "MoySklad connection is not configured."
      )
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "shipping_methods.data"],
      filters: { id: orderId },
    }, { throwIfKeyNotFound: true })
    const order = data[0] as {
      shipping_methods?: Array<{ data?: Record<string, unknown> | null }>
    }
    const isSupported = (order.shipping_methods ?? []).some((method) =>
      method.data?.store_pickup === true ||
      !!method.data?.cdekData ||
      !!method.data?.ozonData
    )
    if (!isSupported) {
      return { status: "skipped", reason: "unsupported_delivery_method" }
    }

    let sync = await service.getOrderSyncStatus(orderId)
    if (!sync?.moysklad_order_id) {
      await createMoyskladCustomerOrderWorkflow(container).run({ input: { orderId } })
      sync = await service.getOrderSyncStatus(orderId)
    }
    if (!sync?.moysklad_order_id) {
      return { status: "skipped", reason: "order_not_synced" }
    }
    if (sync.fulfillment_status === "synced" && sync.moysklad_demand_id) {
      return { status: "already_created", moysklad_demand_id: sync.moysklad_demand_id }
    }

    const claimed = await service.claimFulfillment(orderId)
    if (claimed?.fulfillment_status === "synced" && claimed.moysklad_demand_id) {
      return { status: "already_created", moysklad_demand_id: claimed.moysklad_demand_id }
    }

    const externalCode = `medusa-fulfillment:${orderId}`
    try {
      const existingDemand = await client.findDemandByExternalCode(
        config.encrypted_credentials,
        externalCode
      )
      const demand = existingDemand ?? await client.createCustomerOrderDemand(
        config.encrypted_credentials,
        { customerOrderId: sync.moysklad_order_id, externalCode }
      )

      await service.recordFulfillmentAttempt({
        orderId,
        status: "synced",
        moyskladDemandId: demand.id,
      })
      return {
        status: existingDemand ? "already_created" : "created",
        moysklad_demand_id: demand.id,
      }
    } catch (error) {
      if (isMoyskladCredentialsFailure(error)) {
        await service.markCredentialsReentryRequired(
          error instanceof Error ? error.message : "МойСклад требует повторного ввода реквизитов."
        )
      }
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`MoySklad fulfillment failed for order ${orderId}: ${message}`)
      await service.recordFulfillmentAttempt({ orderId, status: "error", lastError: message })
      throw error
    }
  }, { timeout: 30 })
}

export const completeMoyskladOrderFulfillmentStep = createStep(
  "complete-moysklad-order-fulfillment",
  async (input: { orderId: string }, { container }) =>
    new StepResponse(await completeMoyskladOrderFulfillment(container, input.orderId))
)
