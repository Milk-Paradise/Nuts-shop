import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  CMS_HOMEPAGE_SNAPSHOT_KEY,
  CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY,
  refreshCmsSnapshot,
  verifyCmsWebhook,
} from "../../../lib/cms-snapshot"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const secret = process.env.STRAPI_WEBHOOK_SECRET
  const timestamp = req.headers["x-cms-timestamp"]
  const signature = req.headers["x-cms-signature"]
  const body = JSON.stringify(req.body ?? {})
  if (!secret || typeof timestamp !== "string" || typeof signature !== "string" ||
      !verifyCmsWebhook(body, timestamp, signature, secret)) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Invalid CMS webhook signature")
  }
  const [homepage, notificationTemplates] = await Promise.all([
    refreshCmsSnapshot(req.scope, CMS_HOMEPAGE_SNAPSHOT_KEY),
    refreshCmsSnapshot(req.scope, CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY),
  ])
  return res.status(200).json({
    revision: homepage.revision,
    revisions: {
      [CMS_HOMEPAGE_SNAPSHOT_KEY]: homepage.revision,
      [CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY]: notificationTemplates.revision,
    },
  })
}
