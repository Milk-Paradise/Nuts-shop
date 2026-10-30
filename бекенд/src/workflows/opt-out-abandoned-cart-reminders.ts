import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { updateCustomersWorkflow } from "@medusajs/medusa/core-flows"

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }): Promise<{ data: Record<string, unknown>[] }>
}

// Merges into existing metadata rather than overwriting it — customer.metadata
// may already carry unrelated custom fields, and abandoned-cart-reminder.ts's
// isDueForReminder() reads this same flag back out of the same object.
export async function optOutOfAbandonedCartReminders(
  container: MedusaContainer,
  customerId: string
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
  const { data: customers } = await query.graph({
    entity: "customer",
    fields: ["id", "metadata"],
    filters: { id: customerId },
  })
  const customer = customers[0] as { id: string; metadata: Record<string, unknown> | null } | undefined

  if (!customer) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Customer not found")
  }

  await updateCustomersWorkflow(container).run({
    input: {
      selector: { id: [customerId] },
      update: {
        metadata: { ...(customer.metadata ?? {}), abandoned_cart_reminders_opt_out: true },
      },
    },
  })
}
