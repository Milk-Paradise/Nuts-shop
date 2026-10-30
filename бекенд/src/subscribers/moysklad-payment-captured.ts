import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { PaymentEvents } from "@medusajs/framework/utils"

import { syncMoyskladCapturedPaymentWorkflow } from "../workflows/sync-moysklad-captured-payment"

export { isOrderFullyPaid } from "../workflows/steps/sync-moysklad-captured-payment"

export default async function syncCapturedPaymentToMoysklad({ event, container }: SubscriberArgs<{ id: string }>) {
  await syncMoyskladCapturedPaymentWorkflow(container).run({ input: { paymentId: event.data.id } })
}

export const config: SubscriberConfig = {
  event: PaymentEvents.CAPTURED,
  context: { subscriberId: "moysklad-payment-captured" },
}
