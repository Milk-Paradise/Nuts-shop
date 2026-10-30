import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  Modules,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"

import { storePickupOrderState } from "../modules/store-pickup/utils"

type OrderPlacedEvent = { id: string }

type ConfirmationOrder = {
  id: string
  display_id?: number | null
  email?: string | null
  metadata?: Record<string, unknown> | null
}

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }): Promise<{ data: ConfirmationOrder[] }>
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

export function orderConfirmationContent(order: ConfirmationOrder) {
  const orderNumber = order.display_id ?? order.id
  const pickup = storePickupOrderState(order.metadata)
  const pickupText = pickup
    ? ` Самовывоз: ${pickup.address}. Часы работы: ${pickup.hours}.`
    : ""
  const text = `Заказ №${orderNumber} принят.${pickupText}`

  return {
    subject: `Заказ №${orderNumber} принят`,
    text,
    html: `<p>${escapeHtml(text)}</p>`,
  }
}

export default async function sendOrderConfirmationEmail({
  event,
  container,
}: SubscriberArgs<OrderPlacedEvent>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "email", "metadata"],
      filters: { id: event.data.id },
    })
    const order = data[0]
    if (!order?.email) return

    const notification = container.resolve(Modules.NOTIFICATION)
    await notification.createNotifications({
      to: order.email,
      channel: "email",
      template: "order-confirmation",
      data: {
        order_id: order.id,
        display_id: order.display_id ?? null,
        store_pickup: storePickupOrderState(order.metadata),
      },
      content: orderConfirmationContent(order),
    })
  } catch (error) {
    logger.error(
      `Failed to send order confirmation for order '${event.data.id}': ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.PLACED,
  context: { subscriberId: "send-order-confirmation-email" },
}
