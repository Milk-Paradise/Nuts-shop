import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { parseNotificationChannel } from "../../../../../modules/notification-domain/channel-settings"
import { revokeNotificationChannelWorkflow } from "../../../../../workflows/revoke-notification-channel"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await revokeNotificationChannelWorkflow(req.scope).run({
    input: { channel: parseNotificationChannel(req.params.channel) },
  })
  res.json({ channel: result })
}
