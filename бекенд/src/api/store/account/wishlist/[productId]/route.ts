import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { removeWishlistItem, requireCustomerId } from "../utils"

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = requireCustomerId(req)
  const productId = req.params.productId

  await removeWishlistItem(req.scope, customerId, productId)

  res.status(200).json({ id: productId, deleted: true })
}
