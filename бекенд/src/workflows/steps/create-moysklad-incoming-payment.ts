import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { MoyskladClient, MoyskladApiError, formatMoyskladMoment, isMoyskladCredentialsFailure, type MoyskladPayment } from "../../modules/moysklad-integration/client"
import { MOYSKLAD_INTEGRATION_MODULE } from "../../modules/moysklad-integration"
import type MoyskladIntegrationService from "../../modules/moysklad-integration/service"

export const moyskladPaymentExternalCode = (orderId: string) => `medusa-payment-${orderId}`

export function validateExistingMoyskladPayment(payment: MoyskladPayment, input: { orderId: string; customerOrderId: string; amount: number; currencyCode: string; paidAt: Date }) {
  const expectedSum = Math.round(input.amount * 100)
  const linked = payment.operations?.some((operation) =>
    operation.meta?.href?.endsWith(`/entity/customerorder/${input.customerOrderId}`) && operation.linkedSum === expectedSum
  )
  const sameMoment = payment.moment === formatMoyskladMoment(input.paidAt)
  const currency = payment.rate?.currency?.isoCode?.toLowerCase()
  if (payment.sum !== expectedSum || !linked || !sameMoment || currency !== input.currencyCode.toLowerCase()) {
    throw new MoyskladApiError(`Платёж ${payment.id} с внешним кодом заказа ${input.orderId} не совпадает с локальными данными.`)
  }
}

export async function createMoyskladIncomingPayment(
  container: Pick<MedusaContainer, "resolve">,
  input: { orderId: string; amount: number; currencyCode: string; paidAt: Date },
  client: MoyskladClient = new MoyskladClient()
) {
  const service = container.resolve<MoyskladIntegrationService>(MOYSKLAD_INTEGRATION_MODULE)
  const sync = await service.getOrderSyncStatus(input.orderId)
  if (sync?.payment_status === "synced") return sync

  const externalCode = sync?.payment_external_code ?? moyskladPaymentExternalCode(input.orderId)
  if (!sync) {
    await service.rememberPayment(input.orderId, input.paidAt, externalCode)
  }

  if (sync?.status !== "synced" || !sync.moysklad_order_id) {
    if (sync?.status === "error" && sync.retryable === false) {
      await service.recordPaymentAttempt({
        orderId: input.orderId,
        status: "error",
        paidAt: input.paidAt,
        externalCode,
        lastError: "Заказ окончательно не передан в МойСклад; привязанный платёж создать невозможно."
      })
    }
    return null
  }

  try {
    const config = await service.getConnectionConfig()
    if (!config?.encrypted_credentials) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "MoySklad connection is not configured.")
    }

    const existing = await client.findIncomingPaymentByExternalCode(config.encrypted_credentials, externalCode)
    if (existing) {
      validateExistingMoyskladPayment(existing, { ...input, customerOrderId: sync.moysklad_order_id })
    }
    const payment = existing ?? await client.createIncomingPayment(config.encrypted_credentials, {
      externalCode,
      customerOrderId: sync.moysklad_order_id,
      amount: input.amount,
      currencyCode: input.currencyCode,
      paidAt: input.paidAt
    })

    return await service.recordPaymentAttempt({
      orderId: input.orderId,
      status: "synced",
      paidAt: input.paidAt,
      externalCode,
      moyskladPaymentId: payment.id
    })
  } catch (error) {
    if (isMoyskladCredentialsFailure(error)) {
      await service.markCredentialsReentryRequired(
        error instanceof Error
          ? error.message
          : "МойСклад требует повторного ввода реквизитов."
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    await service.recordPaymentAttempt({
      orderId: input.orderId,
      status: "error",
      paidAt: input.paidAt,
      externalCode,
      lastError: message
    })
    throw error
  }
}

export const createMoyskladIncomingPaymentStep = createStep(
  "create-moysklad-incoming-payment",
  async (input: { orderId: string; amount: number; currencyCode: string; paidAt: Date }, { container }) =>
    new StepResponse(await createMoyskladIncomingPayment(container, input))
)
