import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { getCdekFulfillmentLabel } from "./get-cdek-fulfillment-label"

type LabelOrder = {
  shipping_methods?: Array<{ data?: Record<string, unknown> | null } | null> | null
}

export type DeliveryFulfillmentLabelResult =
  | Awaited<ReturnType<typeof getCdekFulfillmentLabel>>
  | { status: "skipped"; reason: "label_not_supported" }

type LabelAdapter = {
  matches: (order: LabelOrder) => boolean
  getLabel: (container: MedusaContainer, orderId: string) => Promise<DeliveryFulfillmentLabelResult>
}

const labelAdapters: readonly LabelAdapter[] = [
  {
    matches: (order) => (order.shipping_methods ?? []).some(
      (method) => method?.data?.cdekData !== undefined
    ),
    getLabel: getCdekFulfillmentLabel,
  },
]

export async function getDeliveryFulfillmentLabel(
  container: MedusaContainer,
  orderId: string
): Promise<DeliveryFulfillmentLabelResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph(
    {
      entity: "order",
      fields: ["id", "shipping_methods.data"],
      filters: { id: orderId },
    },
    { throwIfKeyNotFound: true }
  )
  const order = (data[0] ?? {}) as LabelOrder
  const adapter = labelAdapters.find((candidate) => candidate.matches(order))
  if (!adapter) return { status: "skipped", reason: "label_not_supported" }

  return adapter.getLabel(container, orderId)
}
