import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { mergeGuestCartIntoCustomer } from "../../../../../workflows/merge-guest-cart-into-customer"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context.actor_id as string
  const guestCartId = req.params.id

  const { cartId, items } = await mergeGuestCartIntoCustomer(req.scope, {
    customerId,
    guestCartId,
  })

  res.status(200).json({ cart_id: cartId, items })
}
