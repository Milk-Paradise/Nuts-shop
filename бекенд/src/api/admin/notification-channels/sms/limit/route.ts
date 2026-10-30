import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { setSmsDailyLimitWorkflow } from "../../../../../workflows/set-sms-daily-limit"
import type { AdminSetSmsDailyLimitBody } from "../../validators"

export async function POST(
  req: AuthenticatedMedusaRequest<AdminSetSmsDailyLimitBody>,
  res: MedusaResponse
) {
  const { result } = await setSmsDailyLimitWorkflow(req.scope).run({
    input: req.validatedBody,
  })
  return res.json({ channel: result })
}
