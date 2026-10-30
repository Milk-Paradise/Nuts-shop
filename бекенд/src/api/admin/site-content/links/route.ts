import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import saveSiteLinkWorkflow from "../../../../workflows/save-site-link"
import type { AdminSaveSiteLinkSchema } from "../validators"

export async function POST(
  req: AuthenticatedMedusaRequest<AdminSaveSiteLinkSchema>,
  res: MedusaResponse
) {
  const { result } = await saveSiteLinkWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  return res.status(200).json({ link: result })
}
