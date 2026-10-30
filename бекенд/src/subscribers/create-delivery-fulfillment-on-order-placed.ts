import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"

import { createDeliveryOrderFulfillmentIfNeeded } from "../workflows/delivery-lifecycle"

type OrderPlacedEvent = { id: string }

type DeliveryOrder = {
  shipping_methods?: Array<{
    shipping_option_id?: string | null
    shipping_option?: { provider_id?: string | null } | null
    data?: Record<string, unknown> | null
  } | null> | null
}

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }): Promise<{ data: DeliveryOrder[] }>
}

export default async function createDeliveryFulfillmentOnOrderPlaced({
  event,
  container,
}: SubscriberArgs<OrderPlacedEvent>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data.id

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "shipping_methods.shipping_option_id",
        "shipping_methods.shipping_option.provider_id",
        "shipping_methods.data",
      ],
      filters: { id: orderId },
    })
    const result = await createDeliveryOrderFulfillmentIfNeeded(
      container,
      orderId,
      data[0]
    )

    if (result.status === "failed") {
      logger.error(
        `Delivery fulfillment creation failed for order '${orderId}': ${result.error}`
      )
    }
  } catch (error) {
    logger.error(
      `Delivery fulfillment creation failed for order '${orderId}': ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.PLACED,
  context: {
    subscriberId: "create-delivery-fulfillment-on-order-placed",
  },
}
