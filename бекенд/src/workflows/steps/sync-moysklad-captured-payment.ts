import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { MOYSKLAD_INTEGRATION_MODULE } from "../../modules/moysklad-integration"
import type MoyskladIntegrationService from "../../modules/moysklad-integration/service"
import { createMoyskladIncomingPayment, moyskladPaymentExternalCode } from "./create-moysklad-incoming-payment"

type Capture = { amount: number; created_at: string | Date }
type Payment = { id: string; payment_collection_id: string; currency_code: string; captures?: Capture[] }
type PaidOrder = { id: string; total: number; currency_code: string; payment_collections?: Array<{ payments?: Array<{ captures?: Capture[] }> }> }

export function isOrderFullyPaid(order: PaidOrder) {
  const captured = (order.payment_collections ?? []).flatMap((collection) => collection.payments ?? [])
    .flatMap((payment) => payment.captures ?? []).reduce((sum, capture) => sum + Number(capture.amount), 0)
  return { fullyPaid: captured >= Number(order.total), capturedAmount: captured }
}

export async function syncMoyskladCapturedPayment(container: Pick<MedusaContainer, "resolve">, paymentId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: payments } = await query.graph({ entity: "payment", fields: ["id", "payment_collection_id", "currency_code", "captures.amount", "captures.created_at"], filters: { id: paymentId } })
  const payment = payments[0] as Payment | undefined
  if (!payment?.payment_collection_id) return

  const { data: links } = await query.graph({ entity: "order_payment_collection", fields: ["order_id", "payment_collection_id"], filters: { payment_collection_id: payment.payment_collection_id } })
  const orderId = links[0]?.order_id as string | undefined
  if (!orderId) return

  const { data: orders } = await query.graph({ entity: "order", fields: ["id", "total", "currency_code", "payment_collections.payments.captures.amount", "payment_collections.payments.captures.created_at"], filters: { id: orderId } })
  const order = orders[0] as PaidOrder | undefined
  if (!order) return
  const classification = isOrderFullyPaid(order)
  if (!classification.fullyPaid) return

  const captures = (payment.captures ?? []).filter((capture) => capture.created_at)
  const paidAt = new Date(Math.max(...captures.map((capture) => new Date(capture.created_at).getTime())))
  if (!captures.length || Number.isNaN(paidAt.getTime())) return

  const service = container.resolve<MoyskladIntegrationService>(MOYSKLAD_INTEGRATION_MODULE)
  await service.rememberPayment(orderId, paidAt, moyskladPaymentExternalCode(orderId), classification.capturedAmount, order.currency_code ?? payment.currency_code)
  const config = await service.getConnectionConfig()
  if (!config?.is_active || !config.encrypted_credentials) return

  const sync = await service.getOrderSyncStatus(orderId)
  if (sync?.status !== "synced" || !sync.moysklad_order_id) {
    if (sync?.status === "error" && sync.retryable === false) {
      await service.recordPaymentAttempt({ orderId, status: "error", lastError: "Заказ окончательно не передан в МойСклад; привязанный платёж создать невозможно." })
    }
    return
  }

  const claimed = await service.claimPaymentForRetry(orderId, ["pending", "error"])
  if (!claimed) return
  return createMoyskladIncomingPayment(container, { orderId, amount: classification.capturedAmount, currencyCode: order.currency_code ?? payment.currency_code, paidAt })
}

export const syncMoyskladCapturedPaymentStep = createStep("sync-moysklad-captured-payment", async (input: { paymentId: string }, { container }) =>
  new StepResponse(await syncMoyskladCapturedPayment(container, input.paymentId))
)
