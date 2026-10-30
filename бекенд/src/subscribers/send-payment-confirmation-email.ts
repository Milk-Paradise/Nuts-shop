import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  Modules,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"

import { paymentProviderRegistry } from "../modules/payment-provider-config/registry"

type OrderPlacedEvent = {
  id: string
}

type Payment = {
  provider_id?: string | null
  captured_at?: string | Date | null
}

type PaymentOrder = {
  id: string
  display_id?: number | null
  email?: string | null
  payment_collections?: Array<{
    payments?: Payment[] | null
  }> | null
}

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }): Promise<{ data: PaymentOrder[] }>
}

const onlinePaymentProviderIds = new Set(
  paymentProviderRegistry.map((provider) => provider.medusa_id)
)

export function hasCapturedOnlinePayment(order: PaymentOrder) {
  return (order.payment_collections ?? []).some((collection) =>
    (collection.payments ?? []).some(
      (payment) =>
        typeof payment.provider_id === "string" &&
        onlinePaymentProviderIds.has(payment.provider_id) &&
        Boolean(payment.captured_at)
    )
  )
}

export default async function sendPaymentConfirmationEmail({
  event,
  container,
}: SubscriberArgs<OrderPlacedEvent>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.captured_at",
      ],
      filters: { id: event.data.id },
    })
    const order = data[0]

    // Manual/system checkout also emits order.placed, but leaves payment in
    // Awaiting. Only a captured payment from an online provider is an actual
    // payment-confirmation event in this project's checkout model.
    if (!order?.email || !hasCapturedOnlinePayment(order)) {
      return
    }

    const orderNumber = order.display_id ?? order.id
    const notification = container.resolve(Modules.NOTIFICATION)

    await notification.createNotifications({
      to: order.email,
      channel: "email",
      template: "order-payment-confirmed",
      data: { order_id: order.id, display_id: order.display_id ?? null },
      content: {
        subject: `Оплата заказа №${orderNumber} подтверждена`,
        text: `Оплата заказа №${orderNumber} успешно подтверждена.`,
        html: `<p>Оплата заказа №${orderNumber} успешно подтверждена.</p>`,
      },
    })
  } catch (error) {
    logger.error(
      `Failed to send payment confirmation for order '${event.data.id}': ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.PLACED,
  context: {
    subscriberId: "send-payment-confirmation-email",
  },
}
