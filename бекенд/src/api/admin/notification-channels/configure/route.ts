import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { configureNotificationChannelWorkflow } from "../../../../workflows/configure-notification-channel"
import type { AdminConfigureNotificationChannelBody } from "../validators"

export async function POST(
  req: AuthenticatedMedusaRequest<AdminConfigureNotificationChannelBody>,
  res: MedusaResponse
) {
  const { result } = await configureNotificationChannelWorkflow(req.scope).run({
    input: req.validatedBody,
  })
  res.json({ channel: result })
}
