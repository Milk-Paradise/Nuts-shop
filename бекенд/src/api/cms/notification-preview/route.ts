import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { verifyCmsWebhook } from "../../../lib/cms-snapshot"
import { previewTestNotificationWorkflow } from "../../../workflows/preview-test-notification"
import type { CmsNotificationPreviewBody } from "./validators"

export async function POST(
  req: MedusaRequest<CmsNotificationPreviewBody>,
  res: MedusaResponse
) {
  const secret = process.env.STRAPI_WEBHOOK_SECRET
  const timestamp = req.headers["x-cms-timestamp"]
  const signature = req.headers["x-cms-signature"]
  const body = JSON.stringify(req.body ?? {})
  if (
    !secret ||
    typeof timestamp !== "string" ||
    typeof signature !== "string" ||
    !verifyCmsWebhook(body, timestamp, signature, secret)
  ) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Invalid CMS webhook signature"
    )
  }

  const { result } = await previewTestNotificationWorkflow(req.scope).run({
    input: req.validatedBody,
  })
  return res.status(200).json(result)
}
