import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PAYMENT_OPERATION_MODULE } from "../../modules/payment-operation"
import type PaymentOperationModuleService from "../../modules/payment-operation/service"

export async function reflectCatalogPaymentOperation(
  container: MedusaContainer,
  input: { operation_id: string; order_id: string }
) {
  const operations = container.resolve<PaymentOperationModuleService>(
    PAYMENT_OPERATION_MODULE
  )

  return operations.markPaymentOperationResultReflected(input)
}

export async function reflectCompletedCatalogPaymentOperationForOrder(
  container: MedusaContainer,
  input: { cart_id: string; order_id: string }
) {
  const operations = container.resolve<PaymentOperationModuleService>(
    PAYMENT_OPERATION_MODULE
  )
  const completed = await operations.listPaymentOperations({
    type: "payment",
    cart_id: input.cart_id,
    state: "completed",
  })

  if (completed.length > 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Cart ${input.cart_id} has more than one completed payment operation`
    )
  }

  if (!completed.length) {
    return { operation: null, applied: false as const }
  }

  return operations.markPaymentOperationResultReflected({
    operation_id: completed[0].id,
    order_id: input.order_id,
  })
}

export const reflectCatalogPaymentOperationStep = createStep(
  "reflect-catalog-payment-operation",
  async (input: { operation_id: string; order_id: string }, { container }) =>
    new StepResponse(await reflectCatalogPaymentOperation(container, input))
)

export const reflectCompletedCatalogPaymentOperationForOrderStep = createStep(
  "reflect-completed-catalog-payment-operation-for-order",
  async (input: { cart_id: string; order_id: string }, { container }) =>
    new StepResponse(
      await reflectCompletedCatalogPaymentOperationForOrder(container, input)
    )
)

export const reflectCatalogPaymentOperationsStep = createStep(
  "reflect-catalog-payment-operations",
  async (
    input: { operation_ids: string[]; order_id: string },
    { container }
  ) => {
    const results: unknown[] = []
    for (const operationId of input.operation_ids) {
      results.push(
        await reflectCatalogPaymentOperation(container, {
          operation_id: operationId,
          order_id: input.order_id,
        })
      )
    }
    return new StepResponse(results)
  }
)
