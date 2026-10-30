import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { CATALOG_SHIPPING_RETURN_REQUESTED } from "../workflows/cancel-catalog-customer-order"

type ShippingReturnRequestedEvent = {
  order_id: string
  return_request_id: string
  return_reason?: string | null
}

export default async function notifySellerReturnRequest({
  event,
  container,
}: SubscriberArgs<ShippingReturnRequestedEvent>) {
  const notification = container.resolve(Modules.NOTIFICATION)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const text = `Получена заявка на возврат по заказу ${event.data.order_id}.`

  try {
    await notification.createNotifications({
      to: "seller",
      channel: "email",
      template: "seller-return-request",
      data: {
        order_id: event.data.order_id,
        return_request_id: event.data.return_request_id,
        return_reason: event.data.return_reason ?? null,
        return_status: "Заявка на возврат получена",
      },
      content: {
        subject: "Заявка на возврат получена",
        text,
        html: `<p>${text}</p>`,
      },
    })
  } catch (error) {
    logger.error(
      `Failed to notify seller about return request for order '${
        event.data.order_id
      }': ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: CATALOG_SHIPPING_RETURN_REQUESTED,
  context: { subscriberId: "notify-seller-return-request" },
}
