import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  retrieveAccountCustomer,
  retrieveAccountOrder,
  type AccountOrder,
} from "../utils"

type AccountOrderResponse = {
  order: AccountOrder
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<AccountOrderResponse>
) {
  const customer = await retrieveAccountCustomer(req)
  const order = await retrieveAccountOrder(req.scope, customer, req.params.id)

  res.status(200).json({ order })
}
