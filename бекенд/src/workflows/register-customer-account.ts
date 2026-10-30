import type { CustomerUpdatableFields, MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createCustomerAccountWorkflow,
  setAuthAppMetadataWorkflow,
  updateCustomersWorkflow,
} from "@medusajs/medusa/core-flows"

export type RegisterCustomerAccountInput = {
  authIdentityId: string
  customerData: {
    email?: string | null
    first_name?: string | null
    last_name?: string | null
    phone?: string | null
    company_name?: string | null
    metadata?: Record<string, unknown> | null
  }
}

// Standard createCustomerAccountWorkflow always inserts a new Customer row,
// even when a passwordless guest customer with the same email already exists
// (see @medusajs/core-flows validate-customer-account-creation.js — it only
// rejects a *second* password account or a guest-only signup with no auth
// identity, neither of which matches "guest customer registers a password").
// That would leave the guest's prior orders orphaned on a stale customer_id
// instead of appearing in the new account's history (spec.md Ф1). Reusing
// the existing guest row here — updating it and pointing the auth identity
// at it — keeps that history intact without a duplicate customer.
export async function registerCustomerAccount(
  container: MedusaContainer,
  input: RegisterCustomerAccountInput
) {
  const customerService = container.resolve(Modules.CUSTOMER)
  const { email } = input.customerData

  const existingCustomers = email
    ? await customerService.listCustomers({ email })
    : []
  const existingAccount = existingCustomers.find((customer) => customer.has_account)

  if (existingAccount) {
    throw new MedusaError(
      MedusaError.Types.DUPLICATE_ERROR,
      "Customer with this email already has an account"
    )
  }

  const existingGuest = existingCustomers.find((customer) => !customer.has_account)

  if (!existingGuest) {
    const { result } = await createCustomerAccountWorkflow(container).run({
      input,
    })
    return result
  }

  // `has_account` is a real Customer column (set the same way by
  // createCustomerAccountWorkflow's own transform), but CustomerUpdatableFields
  // deliberately omits it from the public update surface — cast past the
  // narrower type rather than dropping to the module service directly, so the
  // update still goes through the real workflow (event emission included).
  const { result: updatedCustomers } = await updateCustomersWorkflow(container).run({
    input: {
      selector: { id: existingGuest.id },
      update: {
        has_account: true,
        first_name: input.customerData.first_name ?? existingGuest.first_name,
        last_name: input.customerData.last_name ?? existingGuest.last_name,
        phone: input.customerData.phone ?? existingGuest.phone,
      } as CustomerUpdatableFields & { has_account: boolean },
    },
  })

  await setAuthAppMetadataWorkflow(container).run({
    input: {
      authIdentityId: input.authIdentityId,
      actorType: "customer",
      value: existingGuest.id,
    },
  })

  return updatedCustomers[0]
}
