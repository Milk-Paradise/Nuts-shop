import type { IOrderModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { paymentProviderRegistry } from "../../modules/payment-provider-config/registry"

type RawAmount = number | string | null | undefined

type RawPayment = {
  id?: string
  provider_id?: string
  captures?: Array<{ amount?: RawAmount }> | null
  refunds?: Array<{ amount?: RawAmount }> | null
}

const CATALOG_REFUND_PLANS_METADATA_KEY = "catalog_refund_plans"
type RefundPlanEntry = {
  requested_amount?: number
  refunds: Array<{
    payment_id: string
    amount: number
    currency_code: string
  }>
}
type RefundPlan = Record<string, RefundPlanEntry>

function parseRefundPlans(value: unknown): RefundPlan {
  if (typeof value !== "string") {
    return {}
  }

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? (parsed as RefundPlan) : {}
  } catch {
    return {}
  }
}

async function persistRefundPlan(
  container: MedusaContainer,
  orderId: string,
  metadata: Record<string, unknown>,
  plans: RefundPlan,
  requestId: string,
  refunds: Array<{ payment_id: string; amount: number; currency_code: string }>,
  requestedAmount?: number
) {
  const orderModule = container.resolve(Modules.ORDER) as IOrderModuleService
  await orderModule.updateOrders(orderId, {
    metadata: {
      ...metadata,
      [CATALOG_REFUND_PLANS_METADATA_KEY]: JSON.stringify({
        ...plans,
        [requestId]: {
          requested_amount: requestedAmount,
          refunds: refunds.map((refund) => ({
            payment_id: refund.payment_id,
            amount: refund.amount,
            currency_code: refund.currency_code,
          })),
        },
      } satisfies RefundPlan),
    },
  })
}

function amount(value: RawAmount) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function prepareCatalogOrderRefund(
  container: MedusaContainer,
  input: {
    order_id: string
    requested_by?: string
    requested_amount?: number
    refund_request_id?: string
  }
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "metadata",
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.currency_code",
      "payment_collections.payments.captures.amount",
      "payment_collections.payments.refunds.amount",
    ],
    filters: { id: input.order_id },
  })
  const providerIds = new Set(
    paymentProviderRegistry.map((provider) => provider.medusa_id)
  )
  const payments = ((data[0]?.payment_collections ?? []) as Array<{
    payments?: RawPayment[]
  }>).flatMap((collection) => collection.payments ?? [])
  const refundablePayments = payments
    .filter(
      (payment) =>
        typeof payment.id === "string" &&
        typeof payment.provider_id === "string" &&
        providerIds.has(payment.provider_id)
    )
    .map((payment) => {
      const captured = (payment.captures ?? []).reduce(
        (sum, capture) => sum + amount(capture.amount),
        0
      )
      const refunded = (payment.refunds ?? []).reduce(
        (sum, refund) => sum + amount(refund.amount),
        0
      )

      return {
        payment_id: payment.id as string,
        amount: captured - refunded,
        currency_code: (payment as RawPayment & { currency_code?: string })
          .currency_code ?? "rub",
        created_by: input.requested_by,
        note: "Возврат при отмене заказа покупателем",
      }
    })
    .filter((refund) => refund.amount >= 0)

  const metadata = (data[0]?.metadata ?? {}) as Record<string, unknown>
  const plans = parseRefundPlans(metadata[CATALOG_REFUND_PLANS_METADATA_KEY])

  if (input.refund_request_id) {
    const savedPlan = plans[input.refund_request_id]
    if (savedPlan) {
      const sameAmount =
        (savedPlan.requested_amount === undefined &&
          input.requested_amount === undefined) ||
        savedPlan.requested_amount === input.requested_amount
      if (!sameAmount) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Сумма повторного возврата должна совпадать с исходным запросом"
        )
      }
      const refunds = savedPlan.refunds.map((planned) => {
        const payment = refundablePayments.find(
          (candidate) => candidate.payment_id === planned.payment_id
        )
        if (!payment) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Платёж из сохранённого плана возврата больше недоступен"
          )
        }
        return {
          ...payment,
          amount: planned.amount,
          idempotency_key: `refund-request:${input.refund_request_id}:${planned.payment_id}`,
        }
      })
      return {
        order_id: input.order_id,
        requested_amount: input.requested_amount,
        refund_request_id: input.refund_request_id,
        refunds,
      }
    }
  }

  if (input.requested_amount === undefined) {
    if (input.refund_request_id) {
      const fullPayments = refundablePayments.filter((refund) => refund.amount > 0)
      if (!fullPayments.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "У заказа нет доступного остатка для возврата"
        )
      }
      await persistRefundPlan(
        container,
        input.order_id,
        metadata,
        plans,
        input.refund_request_id,
        fullPayments,
        undefined
      )
      return {
        order_id: input.order_id,
        refunds: fullPayments,
        requested_amount: undefined,
        refund_request_id: input.refund_request_id,
      }
    }
    return {
      order_id: input.order_id,
      refunds: refundablePayments,
      requested_amount: undefined,
      refund_request_id: input.refund_request_id,
    }
  }

  if (
    !Number.isFinite(input.requested_amount) ||
    input.requested_amount <= 0
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Сумма частичного возврата должна быть больше нуля"
    )
  }

  const partialPayments = refundablePayments.filter((refund) => refund.amount > 0)
  const availableAmount = partialPayments.reduce(
    (total, refund) => total + refund.amount,
    0
  )

  if (input.requested_amount > availableAmount) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Сумма возврата превышает доступный остаток"
    )
  }

  let remaining = input.requested_amount
  const refunds = partialPayments.flatMap((refund) => {
    if (remaining <= 0) {
      return []
    }

    const amount = Math.min(refund.amount, remaining)
    remaining -= amount

    return [
      {
        ...refund,
        amount,
        idempotency_key: input.refund_request_id
          ? `refund-request:${input.refund_request_id}:${refund.payment_id}`
          : `payment-action:${refund.payment_id}:${amount}`,
      },
    ]
  })

  if (input.refund_request_id) {
    await persistRefundPlan(
      container,
      input.order_id,
      metadata,
      plans,
      input.refund_request_id,
      refunds,
      input.requested_amount
    )
  }

  return {
    order_id: input.order_id,
    refunds,
    requested_amount: input.requested_amount,
    refund_request_id: input.refund_request_id,
  }
}

export const prepareCatalogOrderRefundStep = createStep(
  "prepare-catalog-order-refund",
  async (
    input: {
      order_id: string
      requested_by?: string
      requested_amount?: number
      refund_request_id?: string
    },
    { container }
  ) => new StepResponse(await prepareCatalogOrderRefund(container, input))
)
