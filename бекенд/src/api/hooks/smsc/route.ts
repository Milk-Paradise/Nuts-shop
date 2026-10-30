import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { processSmscCallbackWorkflow } from "../../../workflows/process-smsc-callback"
import type { SmscCallbackBody } from "./validators"

export async function POST(
  req: MedusaRequest<SmscCallbackBody>,
  res: MedusaResponse
) {
  const { result } = await processSmscCallbackWorkflow(req.scope).run({
    input: req.validatedBody,
  })
  return res.json({ result })
}
