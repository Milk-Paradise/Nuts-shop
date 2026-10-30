import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { TELEGRAM_SECRET_HEADER } from "../../../workflows/steps/telegram-binding"
import { processTelegramWebhookWorkflow } from "../../../workflows/telegram-binding"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const supplied = req.headers[TELEGRAM_SECRET_HEADER]
  const secret = Array.isArray(supplied) ? supplied[0] : supplied
  const { result } = await processTelegramWebhookWorkflow(req.scope).run({
    input: { secret, update: req.body },
  })
  if (result.status === "unavailable") {
    return res.status(503).json({ message: "Telegram channel is not configured" })
  }
  return res.json({ result })
}
