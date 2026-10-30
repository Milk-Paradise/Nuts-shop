import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { createPreviewToken } from "../../../lib/cms-preview"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const internalSecret = process.env.CMS_PREVIEW_INTERNAL_SECRET
  if (!internalSecret || req.headers["x-cms-internal-secret"] !== internalSecret) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Invalid CMS credentials")
  }
  const signingSecret = process.env.CMS_PREVIEW_SIGNING_SECRET
  if (!signingSecret) throw new Error("CMS_PREVIEW_SIGNING_SECRET is required")
  const publicUrl = process.env.STOREFRONT_PUBLIC_URL
  if (!publicUrl) throw new Error("STOREFRONT_PUBLIC_URL is required")
  const url = new URL("/preview", publicUrl)
  url.searchParams.set("token", createPreviewToken(signingSecret))
  return res.status(200).json({ url: url.toString(), expires_in: 600 })
}
