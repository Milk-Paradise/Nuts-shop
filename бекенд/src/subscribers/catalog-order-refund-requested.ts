import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { CATALOG_ORDER_REFUND_REQUESTED } from "../workflows/cancel-catalog-customer-order"
import { refundCatalogCustomerOrderWorkflow } from "../workflows/refund-catalog-customer-order"

type CatalogOrderRefundRequestedEvent = {
  order_id: string
  requested_by?: string
}

export default async function refundCatalogOrder({
  event,
  container,
}: SubscriberArgs<CatalogOrderRefundRequestedEvent>) {
  await refundCatalogCustomerOrderWorkflow(container).run({
    input: event.data,
  })
}

export const config: SubscriberConfig = {
  event: CATALOG_ORDER_REFUND_REQUESTED,
  context: {
    subscriberId: "catalog-order-refund-requested",
  },
}
