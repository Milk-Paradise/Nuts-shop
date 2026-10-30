import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"

import {
  CATALOG_CUSTOMER_ORDER_CANCELED,
  CATALOG_SHIPPING_RETURN_REQUESTED,
} from "../workflows/cancel-catalog-customer-order"
import { CATALOG_SHIPPING_RETURN_RESOLVED } from "../workflows/resolve-shipping-return-request"
import { STORE_PICKUP_RETURN_PROVIDER_KEY } from "../modules/store-pickup/utils"

type ReturnNotificationEvent = {
  order_id: string
  customer_email: string
  decision?: "approved" | "rejected"
  return_tracking_number?: string | null
  provider_key?: string | null
}

export default async function shippingReturnNotification({
  event,
  container,
}: SubscriberArgs<ReturnNotificationEvent>) {
  const notification = container.resolve(Modules.NOTIFICATION)
  const logger = container.resolve("logger")
  const approved = event.data.decision === "approved"
  const rejected = event.data.decision === "rejected"
  const canceled = event.name === CATALOG_CUSTOMER_ORDER_CANCELED
  const pickup = event.data.provider_key === STORE_PICKUP_RETURN_PROVIDER_KEY
  const subject = canceled
    ? "Заказ отменён"
    : approved
    ? "Возврат подтверждён"
    : rejected
      ? "Заявка на возврат отклонена"
      : "Заявка на возврат получена"
  const text = canceled
    ? `Заказ ${event.data.order_id} отменён.`
    : approved
    ? `Возврат по заказу ${event.data.order_id} подтверждён.${event.data.return_tracking_number ? ` Обратный трек-номер: ${event.data.return_tracking_number}.` : ""}`
    : rejected
      ? `Заявка на возврат по заказу ${event.data.order_id} отклонена.${pickup ? "" : " Доставка остаётся в силе."}`
      : `Заявка на возврат по заказу ${event.data.order_id} отправлена на подтверждение.`
  try {
    await notification.createNotifications({
      to: event.data.customer_email,
      channel: "email",
      template: "shipping-return-status",
      data: event.data,
      content: { subject, text, html: `<p>${text}</p>` },
    })
  } catch (error) {
    logger.error(
      `Failed to send shipping return notification for order '${event.data.order_id}': ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: [
    CATALOG_CUSTOMER_ORDER_CANCELED,
    CATALOG_SHIPPING_RETURN_REQUESTED,
    CATALOG_SHIPPING_RETURN_RESOLVED,
  ],
  context: { subscriberId: "shipping-return-notifications" },
}
