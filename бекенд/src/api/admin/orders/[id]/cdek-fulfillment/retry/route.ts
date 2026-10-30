import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { createCdekOrderFulfillmentIfNeeded } from "../../../../../../workflows/create-cdek-order-fulfillment"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const result = await createCdekOrderFulfillmentIfNeeded(req.scope, req.params.id)
  res.json({ result })
}
