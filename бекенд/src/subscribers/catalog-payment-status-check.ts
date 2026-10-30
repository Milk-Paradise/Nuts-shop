import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { CATALOG_PAYMENT_STATUS_CHECK_REQUESTED } from "../workflows/verify-catalog-payment-webhook"
import { finalizeCatalogOnlinePaymentWorkflow } from "../workflows/finalize-catalog-online-payment"

type CatalogPaymentStatusCheckEvent = {
  session_id: string
  provider_id?: string
  provider_payment_id?: string
  event?: string
}

export default async function checkCatalogPaymentStatus({
  event,
  container,
}: SubscriberArgs<CatalogPaymentStatusCheckEvent>) {
  await finalizeCatalogOnlinePaymentWorkflow(container).run({
    input: {
      payment_session_id: event.data.session_id,
      external_event_key:
        event.data.provider_id &&
        event.data.provider_payment_id &&
        event.data.event
          ? `${event.data.provider_id}:${event.data.provider_payment_id}:${event.data.event}`
          : undefined,
    },
  })
}

export const config: SubscriberConfig = {
  event: CATALOG_PAYMENT_STATUS_CHECK_REQUESTED,
  context: {
    subscriberId: "catalog-payment-status-check",
  },
}
