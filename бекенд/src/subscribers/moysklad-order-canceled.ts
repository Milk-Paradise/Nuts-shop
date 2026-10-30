import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { syncMoyskladOrderCancellationWorkflow } from "../workflows/sync-moysklad-order-cancellation"

export default async function markMoyskladOrderCancelled({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  await syncMoyskladOrderCancellationWorkflow(container).run({
    input: { orderId: event.data.id },
  })
}

export const config: SubscriberConfig = {
  event: "order.canceled",
  context: { subscriberId: "moysklad-order-canceled" },
}
