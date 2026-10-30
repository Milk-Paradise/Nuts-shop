import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  retrieveCatalogRefundAdminState,
  retryCatalogOrderRefund,
} from "../../catalog-refund"
import type { AdminCatalogRefundInput } from "../../catalog-refund/validators"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const refund = await retrieveCatalogRefundAdminState(
    req.scope,
    req.params.id
  )

  res.json({ refund })
}

export async function POST(
  req: AuthenticatedMedusaRequest<AdminCatalogRefundInput>,
  res: MedusaResponse
) {
  const body = req.validatedBody

  const refund = await retryCatalogOrderRefund(req.scope, {
    order_id: req.params.id,
    requested_by: req.auth_context.actor_id,
    requested_amount: body.amount,
    confirmed: body.confirm === true,
    request_id: body.request_id,
  })

  res.json({ refund })
}
