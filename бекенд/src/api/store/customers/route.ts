import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { registerCustomerAccount } from "../../../workflows/register-customer-account"

// Overrides the core POST /store/customers handler (same matcher — the
// project's src/api directory is scanned after core's, so this file wins,
// see @medusajs/framework routes-loader.js). Core's auth/validation
// middleware for this route (authenticate + StoreCreateCustomer body schema)
// keeps running unchanged — middleware registration is additive, not
// overridden by this file. Only the guest-account-merge logic (T01) differs
// from core's default createCustomerAccountWorkflow.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  if (req.auth_context.actor_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Request already authenticated as a customer."
    )
  }

  const customerData = req.validatedBody as Record<string, unknown>
  const customer = await registerCustomerAccount(req.scope, {
    authIdentityId: req.auth_context.auth_identity_id!,
    customerData,
  })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "customer",
    fields: req.queryConfig.fields,
    filters: { id: customer.id },
  })

  res.status(200).json({ customer: data[0] })
}
