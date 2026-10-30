import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { changeCustomerPasswordWorkflow } from "../../../../workflows/change-customer-password"
import type { ChangeAccountPassword } from "./validators"

export async function POST(
  req: AuthenticatedMedusaRequest<ChangeAccountPassword>,
  res: MedusaResponse
) {
  await changeCustomerPasswordWorkflow(req.scope).run({
    input: {
      auth_identity_id: req.auth_context.auth_identity_id!,
      current_password: req.validatedBody.current_password,
      new_password: req.validatedBody.new_password,
    },
  })

  return res.status(200).json({ success: true })
}
