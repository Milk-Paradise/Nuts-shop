import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { retrieveAccountCustomer, retrieveAccountOrder } from "../../utils"
import { requestCatalogShippingReturnWorkflow } from "../../../../../../workflows/request-catalog-shipping-return"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customer = await retrieveAccountCustomer(req)
  const { result } = await requestCatalogShippingReturnWorkflow(req.scope).run({
    input: {
      order_id: req.params.id,
      customer_id: customer.id,
      customer_email: customer.email,
    },
  })
  const order = await retrieveAccountOrder(req.scope, customer, req.params.id)
  res.status(200).json({
    order,
    outcome: "return_requested",
    message: "Заявка на возврат отправлена",
    return_request: result.request,
  })
}
