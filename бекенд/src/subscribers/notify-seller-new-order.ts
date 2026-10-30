import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  Modules,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"

type OrderPlacedEvent = { id: string }

export default async function notifySellerNewOrder({
  event,
  container,
}: SubscriberArgs<OrderPlacedEvent>) {
  const notification = container.resolve(Modules.NOTIFICATION)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    await notification.createNotifications({
      to: "seller",
      channel: "email",
      template: "seller-new-order",
      data: { order_id: event.data.id },
      content: {
        subject: "Новый заказ",
        text: `Получен новый заказ ${event.data.id}.`,
        html: `<p>Получен новый заказ ${event.data.id}.</p>`,
      },
    })
  } catch (error) {
    logger.error(
      `Failed to notify seller about order '${event.data.id}': ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.PLACED,
  context: { subscriberId: "notify-seller-new-order" },
}
