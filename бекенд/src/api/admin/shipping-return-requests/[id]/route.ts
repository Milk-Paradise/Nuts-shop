import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { resolveShippingReturnRequestWorkflow } from "../../../../workflows/resolve-shipping-return-request"
import type { ResolveShippingReturnRequestSchema } from "../validators"

export async function POST(
  req: MedusaRequest<ResolveShippingReturnRequestSchema>,
  res: MedusaResponse
) {
  const { result } = await resolveShippingReturnRequestWorkflow(req.scope).run({
    input: {
      request_id: req.params.id,
      decision: req.validatedBody.decision,
    },
  })
  res.status(200).json({ return_request: result.request })
}
