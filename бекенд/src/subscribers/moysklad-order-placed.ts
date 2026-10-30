import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { MOYSKLAD_INTEGRATION_MODULE } from "../modules/moysklad-integration"
import type MoyskladIntegrationService from "../modules/moysklad-integration/service"
import { createMoyskladCustomerOrderWorkflow } from "../workflows/create-moysklad-customer-order"

export default async function syncOrderToMoysklad({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const orderId = event.data.id

  try {
    const moyskladService = container.resolve<MoyskladIntegrationService>(
      MOYSKLAD_INTEGRATION_MODULE
    )
    const connectionConfig = await moyskladService.getConnectionConfig()

    if (!connectionConfig?.is_active || connectionConfig.credentials_status === "needs_reentry") {
      return
    }

    await createMoyskladCustomerOrderWorkflow(container).run({
      input: { orderId },
    })
    logger.info(`MoySklad customer order created for order ${orderId}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    logger.error(
      `MoySklad customer order sync failed for order ${orderId}: ${message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: {
    subscriberId: "moysklad-order-placed",
  },
}
