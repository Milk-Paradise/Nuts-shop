import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { getDeliveryFulfillmentLabel } from "../../../../../../workflows/get-delivery-fulfillment-label"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const result = await getDeliveryFulfillmentLabel(req.scope, req.params.id)
  res.status(200).json({ result })
}
