import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"

import { completeMoyskladOrderFulfillmentWorkflow } from "../workflows/complete-moysklad-order-fulfillment-workflow"

export default async function syncOrderFulfillmentToMoysklad({ event, container }: SubscriberArgs<{
  order_id: string
  fulfillment_id: string
}>) {
  try {
    await completeMoyskladOrderFulfillmentWorkflow(container).run({
      input: { orderId: event.data.order_id },
    })
  } catch (error) {
    const logger = container.resolve("logger")
    logger.error(
      `MoySklad fulfillment sync failed for order ${event.data.order_id}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.FULFILLMENT_CREATED,
  context: { subscriberId: "moysklad-order-fulfillment-created" },
}
