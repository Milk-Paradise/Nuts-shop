import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { downloadCdekFulfillmentLabel } from "../../../../../../../workflows/get-cdek-fulfillment-label"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pdf = await downloadCdekFulfillmentLabel(req.scope, req.params.id)
  res.setHeader("content-type", "application/pdf")
  res.setHeader("content-disposition", `inline; filename="cdek-label-${req.params.id}.pdf"`)
  res.status(200).send(pdf)
}
