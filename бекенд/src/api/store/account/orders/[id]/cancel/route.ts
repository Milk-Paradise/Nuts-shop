import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  retrieveAccountCustomer,
  retrieveAccountOrder,
  type AccountOrder,
} from "../../utils"
import { cancelCatalogCustomerOrderWorkflow } from "../../../../../../workflows/cancel-catalog-customer-order"
import { catalogOrderCancellationResponse } from "./response"

type CancelAccountOrderResponse = {
  order: AccountOrder
  outcome: "canceled" | "return_requested"
  message: string
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<CancelAccountOrderResponse>
) {
  const customer = await retrieveAccountCustomer(req)

  const { result } = await cancelCatalogCustomerOrderWorkflow(req.scope).run({
    input: {
      order_id: req.params.id,
      customer_id: customer.id,
      customer_email: customer.email,
    },
  })

  const order = await retrieveAccountOrder(req.scope, customer, req.params.id)

  res.status(200).json(catalogOrderCancellationResponse(order, result.outcome))
}
