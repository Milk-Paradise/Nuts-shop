import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { cancelOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"

export type CancelOrderDeliveryFulfillmentsInput = {
  order_id: string
  fulfillment_ids: string[]
}

export async function cancelOrderCdekFulfillments(
  container: MedusaContainer,
  input: CancelOrderDeliveryFulfillmentsInput
) {
  for (const fulfillmentId of input.fulfillment_ids) {
    try {
      await cancelOrderFulfillmentWorkflow(container).run({
        input: { order_id: input.order_id, fulfillment_id: fulfillmentId },
      })
    } catch {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Отмена сейчас недоступна. Попробуйте повторить попытку позже."
      )
    }
  }

  return true
}

export const cancelOrderCdekFulfillmentsStep = createStep(
  "cancel-order-cdek-fulfillments",
  async (input: CancelOrderDeliveryFulfillmentsInput, { container }) =>
    new StepResponse(await cancelOrderCdekFulfillments(container, input))
)
