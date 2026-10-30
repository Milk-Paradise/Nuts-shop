import type { MedusaContainer } from "@medusajs/framework/types"

import { MOYSKLAD_INTEGRATION_MODULE } from "../modules/moysklad-integration"
import type MoyskladIntegrationService from "../modules/moysklad-integration/service"
import { isOrderSyncDueForRetry } from "../modules/moysklad-integration/retry-schedule"
import { createMoyskladCustomerOrderWorkflow } from "../workflows/create-moysklad-customer-order"
import { createMoyskladIncomingPaymentWorkflow } from "../workflows/create-moysklad-incoming-payment"
import { syncMoyskladOrderCancellationWorkflow } from "../workflows/sync-moysklad-order-cancellation"

type OrderSyncRow = {
  order_id: string
  status: string
  attempts: number
  updated_at: Date
  moysklad_order_id: string | null
  cancellation_status: string | null
  cancellation_attempts: number
  cancellation_updated_at: Date | null
  retryable?: boolean
  payment_status?: string | null
  payment_attempts?: number
  payment_updated_at?: Date | null
  payment_paid_at?: Date | null
  payment_amount?: number | null
  payment_currency_code?: string | null
}

function isCancellationDueForRetry(orderSync: OrderSyncRow, now: Date) {
  if (orderSync.cancellation_status == null) {
    return false
  }

  // The create sync must have actually landed before there is anything to
  // annotate in MoySklad.
  if (orderSync.status !== "synced" || !orderSync.moysklad_order_id) {
    return false
  }

  if (orderSync.cancellation_updated_at == null) {
    return false
  }

  return isOrderSyncDueForRetry(
    {
      status: orderSync.cancellation_status,
      attempts: orderSync.cancellation_attempts,
      updated_at: orderSync.cancellation_updated_at,
    },
    now
  )
}

export default async function retryMoyskladOrderSync(
  container: MedusaContainer
) {
  if (process.env.E2E_RUN === "true") return
  const logger = container.resolve("logger")
  const moyskladService = container.resolve<MoyskladIntegrationService>(
    MOYSKLAD_INTEGRATION_MODULE
  )

  try {
    const connectionConfig = await moyskladService.getConnectionConfig()

    if (!connectionConfig?.is_active || connectionConfig.credentials_status === "needs_reentry") {
      return
    }

    const orderSyncs = await moyskladService.listMoyskladOrderSyncs({})
    const now = new Date()
    const dueOrderSyncs = orderSyncs.filter(
      (orderSync) =>
        orderSync.retryable !== false &&
        isOrderSyncDueForRetry(orderSync, now)
    )
    const dueCancellations = orderSyncs.filter((orderSync) =>
      isCancellationDueForRetry(orderSync as never, now)
    )
    const duePayments = orderSyncs.filter((orderSync) =>
      orderSync.payment_status != null &&
      orderSync.payment_updated_at != null &&
      ((orderSync.status === "synced" && Boolean(orderSync.moysklad_order_id)) ||
        (orderSync.status === "error" && orderSync.retryable === false)) &&
      ((orderSync.payment_attempts ?? 0) === 0 || isOrderSyncDueForRetry({
        status: orderSync.payment_status,
        attempts: orderSync.payment_attempts ?? 0,
        updated_at: orderSync.payment_updated_at
      }, now))
    )

    for (const orderSync of dueOrderSyncs) {
      try {
        // Claim the retry slot first: a fresh `updated_at` makes this order
        // look not-due to the next tick, so a slow attempt (e.g. MoySklad
        // taking longer than the 1-minute schedule) can't overlap with
        // another tick and create a second document in MoySklad. Includes
        // "syncing" so a claim left behind by a crashed/killed process (the
        // stale-syncing case `isOrderSyncDueForRetry` already re-arms) can
        // actually be re-claimed instead of being stuck forever.
        const claimed = await moyskladService.claimOrderSyncForRetry(
          orderSync.order_id,
          ["pending", "error", "syncing"]
        )

        if (!claimed) {
          continue
        }

        await createMoyskladCustomerOrderWorkflow(container).run({
          input: { orderId: orderSync.order_id },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        logger.error(
          `MoySklad order sync retry failed for order ${orderSync.order_id}: ${message}`
        )
      }
    }

    for (const orderSync of dueCancellations) {
      try {
        // Same claim-before-call reasoning as the create branch above, on
        // the independent cancellation_* columns (including the "syncing"
        // reclaim for the same stale-process reason).
        const claimed = await moyskladService.claimCancellationForRetry(
          orderSync.order_id,
          ["pending", "error", "syncing"]
        )

        if (!claimed) {
          continue
        }

        await syncMoyskladOrderCancellationWorkflow(container).run({
          input: { orderId: orderSync.order_id },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        logger.error(
          `MoySklad cancellation mark retry failed for order ${orderSync.order_id}: ${message}`
        )
      }
    }

    for (const orderSync of duePayments) {
      try {
        if (!orderSync.payment_paid_at || orderSync.payment_amount == null || !orderSync.payment_currency_code) continue
        const claimed = await moyskladService.claimPaymentForRetry(
          orderSync.order_id,
          ["pending", "error", "syncing"],
          orderSync.payment_updated_at ?? undefined
        )
        if (!claimed) continue
        await createMoyskladIncomingPaymentWorkflow(container).run({
          input: {
            orderId: orderSync.order_id,
            amount: orderSync.payment_amount,
            currencyCode: orderSync.payment_currency_code,
            paidAt: orderSync.payment_paid_at,
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`MoySklad payment sync retry failed for order ${orderSync.order_id}: ${message}`)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    logger.error(`MoySklad order sync retry job failed: ${message}`)
  }
}

export const config = {
  name: "moysklad-order-sync-retry",
  schedule: "* * * * *",
}
