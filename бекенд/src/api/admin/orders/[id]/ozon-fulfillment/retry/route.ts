import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { createOzonOrderFulfillmentIfNeeded } from "../../../../../../workflows/create-ozon-order-fulfillment"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const result = await createOzonOrderFulfillmentIfNeeded(req.scope, req.params.id)
  res.status(result.status === "failed" ? 502 : 200).json({ result })
}
