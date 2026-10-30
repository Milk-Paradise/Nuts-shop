import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { addWishlistItem, listWishlistItems, requireCustomerId } from "./utils"
import type { AddWishlistItemSchema } from "./validators"
import type { z } from "zod"

function parseOffset(value: unknown): number {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = requireCustomerId(req)
  const offset = parseOffset(req.query.offset)

  const { items, count } = await listWishlistItems(req.scope, customerId, offset)

  res.status(200).json({ items, count })
}

export async function POST(
  req: AuthenticatedMedusaRequest<z.infer<typeof AddWishlistItemSchema>>,
  res: MedusaResponse
) {
  const customerId = requireCustomerId(req)
  const item = await addWishlistItem(req.scope, customerId, req.validatedBody.product_id)

  res.status(200).json({ item })
}
