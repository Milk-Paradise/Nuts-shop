import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { MOYSKLAD_INTEGRATION_MODULE } from "../../../../../modules/moysklad-integration"
import type MoyskladIntegrationService from "../../../../../modules/moysklad-integration/service"
import { createMoyskladCustomerOrderWorkflow } from "../../../../../workflows/create-moysklad-customer-order"
import { retryMoyskladOrderSyncWorkflow } from "../../../../../workflows/retry-moysklad-order-sync"
import type { MoyskladRetryTarget } from "../../../../../workflows/steps/retry-moysklad-order-sync"

type MoyskladSyncStatus = "pending" | "syncing" | "synced" | "error" | null

type MoyskladOrderSyncResponse = {
  status: MoyskladSyncStatus
  moysklad_order_id: string | null
  last_error: string | null
  attempts: number
  cancellation_status: MoyskladSyncStatus
  cancellation_last_error: string | null
  cancellation_attempts: number
  payment_status: MoyskladSyncStatus
  payment_last_error: string | null
  payment_attempts: number
  moysklad_payment_id: string | null
}

function serializeOrderSync(orderSync: {
  status: MoyskladOrderSyncResponse["status"]
  moysklad_order_id?: string | null
  last_error?: string | null
  attempts?: number
  cancellation_status?: MoyskladOrderSyncResponse["cancellation_status"]
  cancellation_last_error?: string | null
  cancellation_attempts?: number
  payment_status?: MoyskladOrderSyncResponse["payment_status"]
  payment_last_error?: string | null
  payment_attempts?: number
  moysklad_payment_id?: string | null
} | null): MoyskladOrderSyncResponse {
  return {
    status: orderSync?.status ?? null,
    moysklad_order_id: orderSync?.moysklad_order_id ?? null,
    last_error: orderSync?.last_error ?? null,
    attempts: orderSync?.attempts ?? 0,
    cancellation_status: orderSync?.cancellation_status ?? null,
    cancellation_last_error: orderSync?.cancellation_last_error ?? null,
    cancellation_attempts: orderSync?.cancellation_attempts ?? 0,
    payment_status: orderSync?.payment_status ?? null,
    payment_last_error: orderSync?.payment_last_error ?? null,
    payment_attempts: orderSync?.payment_attempts ?? 0,
    moysklad_payment_id: orderSync?.moysklad_payment_id ?? null,
  }
}

// An unknown target is dropped rather than passed through: falling back to the
// legacy priority order is safe, whereas trusting a bad value would let a typo
// decide which of the three transfers gets retried.
function parseRetryTarget(value: unknown): MoyskladRetryTarget | undefined {
  return value === "order" || value === "payment" || value === "cancellation"
    ? value
    : undefined
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse<MoyskladOrderSyncResponse>
) {
  const service = req.scope.resolve<MoyskladIntegrationService>(
    MOYSKLAD_INTEGRATION_MODULE
  )
  const orderSync = await service.getOrderSyncStatus(req.params.id)

  return res.status(200).json(serializeOrderSync(orderSync))
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse<MoyskladOrderSyncResponse>
) {
  const target = parseRetryTarget((req.body as { target?: unknown } | undefined)?.target)
  const { result } = target === "order"
    ? await createMoyskladCustomerOrderWorkflow(req.scope).run({
        input: { orderId: req.params.id },
      })
    : await retryMoyskladOrderSyncWorkflow(req.scope).run({
        input: { orderId: req.params.id, target },
      })

  return res.status(200).json(serializeOrderSync(result as never))
}
