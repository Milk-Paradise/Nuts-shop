import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { MOYSKLAD_INTEGRATION_MODULE } from "../../modules/moysklad-integration"
import type MoyskladIntegrationService from "../../modules/moysklad-integration/service"
import { createMoyskladCustomerOrder } from "./create-moysklad-customer-order"
import { markMoyskladCustomerOrderCancelled } from "./mark-moysklad-customer-order-cancelled"
import { createMoyskladIncomingPayment } from "./create-moysklad-incoming-payment"

// Which of the three independent transfers a manual retry addresses. Without
// it the branches below are tried in a fixed order, so pressing "retry" next to
// the order would silently retry the payment instead whenever both had failed.
export type MoyskladRetryTarget = "order" | "payment" | "cancellation"

export async function retryMoyskladOrderSync(
  container: Pick<MedusaContainer, "resolve">,
  input: { orderId: string; target?: MoyskladRetryTarget }
) {
  const moyskladService = container.resolve<MoyskladIntegrationService>(
    MOYSKLAD_INTEGRATION_MODULE
  )
  const orderSync = await moyskladService.getOrderSyncStatus(input.orderId)
  const target = input.target

  if (target === "payment" && orderSync?.payment_status !== "error") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Only a failed MoySklad payment transfer can be retried manually."
    )
  }

  if (target === "cancellation" && orderSync?.cancellation_status !== "error") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Only a failed MoySklad cancellation mark can be retried manually."
    )
  }

  if (target !== "order" && target !== "cancellation" && orderSync?.payment_status === "error") {
    if (orderSync.payment_amount == null || !orderSync.payment_currency_code || !orderSync.payment_paid_at) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "The MoySklad payment retry data is incomplete.")
    }
    const claimedPayment = await moyskladService.claimPaymentForRetry(input.orderId, ["error"])
    if (claimedPayment) {
      return createMoyskladIncomingPayment(container, {
        orderId: input.orderId,
        amount: orderSync.payment_amount,
        currencyCode: orderSync.payment_currency_code,
        paidAt: orderSync.payment_paid_at
      })
    }
  }

  if (target !== "order" && target !== "payment" && orderSync?.cancellation_status === "error") {
    const claimedCancellation = await moyskladService.claimCancellationForRetry(
      input.orderId,
      ["error"]
    )

    if (claimedCancellation) {
      return markMoyskladCustomerOrderCancelled(container, input)
    }

    const currentOrderSync = await moyskladService.getOrderSyncStatus(
      input.orderId
    )

    if (
      currentOrderSync?.cancellation_status === "syncing" ||
      currentOrderSync?.cancellation_status === "synced"
    ) {
      return currentOrderSync
    }

    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The MoySklad cancellation mark can no longer be retried."
    )
  }

  const claimedOrderSync = await moyskladService.claimOrderSyncForRetry(
    input.orderId,
    ["error"]
  )

  if (!claimedOrderSync) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Only failed MoySklad order synchronizations can be retried manually."
    )
  }

  return createMoyskladCustomerOrder(container, input)
}

export const retryMoyskladOrderSyncStep = createStep(
  "retry-moysklad-order-sync",
  async (input: { orderId: string; target?: MoyskladRetryTarget }, { container }) => {
    const orderSync = await retryMoyskladOrderSync(container, input)

    return new StepResponse(orderSync)
  }
)
