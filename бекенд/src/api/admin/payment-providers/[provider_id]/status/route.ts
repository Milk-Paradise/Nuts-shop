import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { z } from "zod"

import { setPaymentProviderEnabledWorkflow } from "../../../../../workflows/set-payment-provider-enabled"
import { AdminUpdatePaymentProviderStatus } from "../../validators"

type AdminUpdatePaymentProviderStatusInput = z.infer<
  typeof AdminUpdatePaymentProviderStatus
>

export async function POST(
  req: AuthenticatedMedusaRequest<AdminUpdatePaymentProviderStatusInput>,
  res: MedusaResponse
) {
  const { result: paymentProvider } = await setPaymentProviderEnabledWorkflow(
    req.scope
  ).run({
    input: {
      provider_id: req.params.provider_id,
      is_enabled: req.validatedBody.is_enabled,
      actor_id: req.auth_context.actor_id,
    },
  })

  res.json({ payment_provider: paymentProvider })
}
