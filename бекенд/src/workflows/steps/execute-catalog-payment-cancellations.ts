import type {
  IPaymentModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PAYMENT_OPERATION_MODULE } from "../../modules/payment-operation"
import type PaymentOperationModuleService from "../../modules/payment-operation/service"

export type CatalogPaymentCancellationInput = {
  order_id: string
  payments: Array<{
    payment_id: string
    provider_id: string
    amount: number
    currency_code: string
  }>
}

export async function executeCatalogPaymentCancellations(
  container: MedusaContainer,
  input: CatalogPaymentCancellationInput
) {
  const payments = container.resolve(Modules.PAYMENT) as IPaymentModuleService
  const operations = container.resolve<PaymentOperationModuleService>(
    PAYMENT_OPERATION_MODULE
  )
  const operationIds: string[] = []

  for (const payment of input.payments) {
    const claimed = await operations.claimPaymentOperation({
      type: "cancellation",
      original_payment_id: payment.payment_id,
      provider_id: payment.provider_id,
      order_id: input.order_id,
      amount: payment.amount,
      currency_code: payment.currency_code,
      idempotency_key: `payment-action:${payment.payment_id}`,
      action: "cancel",
    })

    if (
      claimed.operation.state !== "processing" &&
      claimed.operation.state !== "retry_pending" &&
      claimed.operation.state !== "completed"
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Отмена не может быть повторена в текущем состоянии операции"
      )
    }

    if (claimed.operation.state !== "completed") {
      try {
        await payments.cancelPayment(payment.payment_id)
      } catch (error) {
        await operations.transitionPaymentOperation({
          operation_id: claimed.operation.id,
          to_state: "result_unknown",
          source: "provider",
          action: "cancel",
          result: "error",
          error_category: "provider_error",
          error_reason:
            error instanceof Error ? error.message.slice(0, 2000) : "Unknown error",
        })
        throw error
      }

      await operations.transitionPaymentOperation({
        operation_id: claimed.operation.id,
        to_state: "completed",
        source: "provider",
        action: "cancel",
        result: "canceled",
      })
    }

    operationIds.push(claimed.operation.id)
  }

  return { operation_ids: operationIds }
}

export const executeCatalogPaymentCancellationsStep = createStep(
  "execute-catalog-payment-cancellations",
  async (input: CatalogPaymentCancellationInput, { container }) =>
    new StepResponse(await executeCatalogPaymentCancellations(container, input))
)
