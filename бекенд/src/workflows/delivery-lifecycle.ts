import type { MedusaContainer } from "@medusajs/framework/types"

import { CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY } from "../modules/shipping-provider-registry/provider-keys"
import {
  createCdekOrderFulfillmentIfNeeded,
  findCdekShippingMethod,
  type CreateCdekOrderFulfillmentResult,
} from "./create-cdek-order-fulfillment"
import {
  createOzonOrderFulfillmentIfNeeded,
  findOzonShippingMethod,
  type CreateOzonOrderFulfillmentResult,
} from "./create-ozon-order-fulfillment"

type OrderForLifecycle = {
  shipping_methods?: Array<{
    shipping_option_id?: string | null
    shipping_option?: { provider_id?: string | null } | null
    data?: Record<string, unknown> | null
  } | null> | null
}

type NormalizedOrderForLifecycle = {
  shipping_methods?: Array<{
    shipping_option_id?: string | null
    shipping_option?: { provider_id?: string | null } | null
    data?: Record<string, unknown> | null
  }> | null
}

function normalizeOrderForLifecycle(
  order: OrderForLifecycle | undefined
): NormalizedOrderForLifecycle {
  return {
    shipping_methods: (order?.shipping_methods ?? []).filter(
      (method): method is NonNullable<typeof method> => method !== null
    ),
  }
}

export type DeliveryFulfillmentResult =
  | CreateCdekOrderFulfillmentResult
  | CreateOzonOrderFulfillmentResult
  | { status: "skipped"; reason: "unsupported_delivery_method" }

type DeliveryLifecycleAdapter = {
  provider_key: string
  matchesOrder: (order: OrderForLifecycle | undefined) => boolean
  createForwardFulfillment: (
    container: MedusaContainer,
    orderId: string
  ) => Promise<DeliveryFulfillmentResult>
}

// Provider-specific protocol details live behind these adapters. Callers only
// select a delivery method and invoke the common lifecycle operation.
const deliveryLifecycleAdapters: readonly DeliveryLifecycleAdapter[] = [
  {
    provider_key: CDEK_PROVIDER_KEY,
    matchesOrder: (order) =>
      findCdekShippingMethod(
        normalizeOrderForLifecycle(order) as Parameters<typeof findCdekShippingMethod>[0]
      ) !== null,
    createForwardFulfillment: createCdekOrderFulfillmentIfNeeded,
  },
  {
    provider_key: OZON_PROVIDER_KEY,
    matchesOrder: (order) =>
      findOzonShippingMethod(
        normalizeOrderForLifecycle(order) as Parameters<typeof findOzonShippingMethod>[0]
      ) !== null,
    createForwardFulfillment: createOzonOrderFulfillmentIfNeeded,
  },
]

export async function createDeliveryOrderFulfillmentIfNeeded(
  container: MedusaContainer,
  orderId: string,
  order: OrderForLifecycle | undefined
): Promise<DeliveryFulfillmentResult> {
  const adapter = deliveryLifecycleAdapters.find((candidate) => candidate.matchesOrder(order))
  if (!adapter) return { status: "skipped", reason: "unsupported_delivery_method" }

  return adapter.createForwardFulfillment(container, orderId)
}
