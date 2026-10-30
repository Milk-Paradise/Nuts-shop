import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { parseNotificationChannel } from "../../../../../modules/notification-domain/channel-settings"
import { setNotificationChannelEnabledWorkflow } from "../../../../../workflows/set-notification-channel-enabled"
import type { AdminSetNotificationChannelEnabledBody } from "../../validators"

export async function POST(
  req: AuthenticatedMedusaRequest<AdminSetNotificationChannelEnabledBody>,
  res: MedusaResponse
) {
  const { result } = await setNotificationChannelEnabledWorkflow(req.scope).run({
    input: {
      channel: parseNotificationChannel(req.params.channel),
      enabled: req.validatedBody.enabled,
    },
  })
  res.json({ channel: result })
}
