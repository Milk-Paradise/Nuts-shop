import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"

import { completeMoyskladOrderFulfillmentWorkflow } from "../../../../../../workflows/complete-moysklad-order-fulfillment-workflow"
import { markStorePickupCollectedWorkflow } from "../../../../../../workflows/mark-store-pickup-collected"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await markStorePickupCollectedWorkflow(req.scope).run({
    input: { order_id: req.params.id },
  })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "items.id",
      "items.quantity",
      "items.detail.quantity",
      "items.requires_shipping",
      "shipping_methods.shipping_option_id",
      "shipping_methods.data",
      "fulfillments.provider_id",
      "fulfillments.canceled_at",
    ],
    filters: { id: req.params.id },
  }, { throwIfKeyNotFound: true })
  const order = data[0] as {
    items?: Array<{ id: string; quantity: number; requires_shipping?: boolean | null }>
    shipping_methods?: Array<{ shipping_option_id?: string | null; data?: Record<string, unknown> | null }>
    fulfillments?: Array<{ provider_id?: string | null; canceled_at?: string | null }>
  }
  const method = (order.shipping_methods ?? []).find((item) => item.data?.store_pickup === true)
  const hasActiveFulfillment = (order.fulfillments ?? []).some((item) => !item.canceled_at)
  if (method && !hasActiveFulfillment) {
    await createOrderFulfillmentWorkflow(req.scope).run({
      input: {
        order_id: req.params.id,
        items: (order.items ?? [])
          .filter((item) => item.requires_shipping !== false)
          .map((item) => ({ id: item.id, quantity: item.quantity })),
        shipping_option_id: method.shipping_option_id ?? undefined,
      },
    })
  }

  const moyskladFulfillment = await completeMoyskladOrderFulfillmentWorkflow(req.scope).run({
    input: { orderId: req.params.id },
  })

  res.status(200).json({ store_pickup: result, moysklad_fulfillment: moyskladFulfillment.result })
}
