import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import deleteSiteLinkWorkflow from "../../../../../workflows/delete-site-link"

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await deleteSiteLinkWorkflow(req.scope).run({
    input: { id: req.params.id },
  })

  return res.status(200).json({ id: result.id, deleted: true })
}
