import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ILockingModule } from "@medusajs/framework/types"
import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"

import { OZON_PROVIDER_KEY } from "../modules/shipping-provider-registry"

type OrderForOzonFulfillment = {
  id: string
  items?: Array<{ id: string; quantity: number; requires_shipping?: boolean | null }> | null
  shipping_methods?: Array<{
    shipping_option_id?: string | null
    data?: Record<string, unknown> | null
  }> | null
  fulfillments?: Array<{ provider_id?: string | null }> | null
}

export type CreateOzonOrderFulfillmentResult =
  | { status: "created" }
  | { status: "skipped"; reason: "not_ozon" | "already_fulfilled" | "no_items" }
  | { status: "failed"; error: string }

export function findOzonShippingMethod(order: OrderForOzonFulfillment | undefined) {
  return (order?.shipping_methods ?? []).find((method) => !!method.data?.ozonData) ?? null
}

export async function createOzonOrderFulfillmentIfNeeded(
  container: MedusaContainer,
  orderId: string
): Promise<CreateOzonOrderFulfillmentResult> {
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  return locking.execute(`ozon-order-fulfillment:${orderId}`, async () => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "items.id",
        "items.quantity",
        "items.requires_shipping",
        "shipping_methods.shipping_option_id",
        "shipping_methods.data",
        "fulfillments.provider_id",
      ],
      filters: { id: orderId },
    }, { throwIfKeyNotFound: true })
    const order = data[0] as OrderForOzonFulfillment
    const method = findOzonShippingMethod(order)
    if (!method) return { status: "skipped", reason: "not_ozon" }
    if ((order.fulfillments ?? []).some((item) => item.provider_id === OZON_PROVIDER_KEY)) {
      return { status: "skipped", reason: "already_fulfilled" }
    }
    const items = (order.items ?? [])
      .filter((item) => item.requires_shipping !== false)
      .map((item) => ({ id: item.id, quantity: item.quantity }))
    if (!items.length) return { status: "skipped", reason: "no_items" }

    try {
      await createOrderFulfillmentWorkflow(container).run({
        input: {
          order_id: orderId,
          items,
          shipping_option_id: method.shipping_option_id ?? undefined,
        },
      })
      return { status: "created" }
    } catch (error) {
      return { status: "failed", error: describeError(error) }
    }
  }, { timeout: 20 })
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
