import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import upsertSiteTabWorkflow from "../../../../workflows/upsert-site-tab"
import type { AdminSaveSiteTabSchema } from "../validators"

export async function POST(
  req: AuthenticatedMedusaRequest<AdminSaveSiteTabSchema>,
  res: MedusaResponse
) {
  const { result } = await upsertSiteTabWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  return res.status(200).json({ tab: result })
}
