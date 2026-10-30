import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { listWishlistProductIds, requireCustomerId } from "../utils"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = requireCustomerId(req)
  const productIds = await listWishlistProductIds(req.scope, customerId)

  res.status(200).json({ product_ids: productIds })
}
