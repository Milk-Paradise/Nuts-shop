import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { verifyAbandonedCartUnsubscribeToken } from "../../../../lib/abandoned-cart-links"
import { optOutOfAbandonedCartReminders } from "../../../../workflows/opt-out-abandoned-cart-reminders"
import type { UnsubscribeAbandonedCartInput } from "./validators"

// Intentionally unauthenticated (no `authenticate` middleware, see
// middlewares.ts) — the recipient is clicking a link from an email, not
// browsing with a session. The signed token (see abandoned-cart-links.ts)
// is what stands in for authorization here.
export async function POST(
  req: MedusaRequest<UnsubscribeAbandonedCartInput>,
  res: MedusaResponse
) {
  const { customer_id: customerId, token } = req.validatedBody

  if (!verifyAbandonedCartUnsubscribeToken(customerId, token)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Invalid unsubscribe token")
  }

  await optOutOfAbandonedCartReminders(req.scope, customerId)

  res.status(200).json({ opted_out: true })
}
