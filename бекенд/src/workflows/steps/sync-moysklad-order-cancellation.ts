import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { MOYSKLAD_INTEGRATION_MODULE } from "../../modules/moysklad-integration"
import type MoyskladIntegrationService from "../../modules/moysklad-integration/service"
import { createMoyskladCustomerOrder } from "./create-moysklad-customer-order"
import { markMoyskladCustomerOrderCancelled } from "./mark-moysklad-customer-order-cancelled"

export async function syncMoyskladOrderCancellation(
  container: Pick<MedusaContainer, "resolve">,
  orderId: string
) {
  const service = container.resolve<MoyskladIntegrationService>(MOYSKLAD_INTEGRATION_MODULE)
  await service.rememberCancellation(orderId)
  const config = await service.getConnectionConfig()
  if (!config?.is_active || config.credentials_status === "needs_reentry") return null

  await createMoyskladCustomerOrder(container, { orderId })
  return markMoyskladCustomerOrderCancelled(container, { orderId })
}

export const syncMoyskladOrderCancellationStep = createStep(
  "sync-moysklad-order-cancellation",
  async (input: { orderId: string }, { container }) =>
    new StepResponse(await syncMoyskladOrderCancellation(container, input.orderId))
)
