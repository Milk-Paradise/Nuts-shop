import type {
  BigNumberInput,
  ILockingModule,
  IOrderModuleService,
  IPaymentModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MathBN,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PAYMENT_OPERATION_MODULE } from "../../modules/payment-operation"
import type PaymentOperationModuleService from "../../modules/payment-operation/service"
import type { VerifiedCatalogRefundWebhook } from "./verify-catalog-refund-webhook"

export const CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY =
  "catalog_payment_operation_id"
export const YOOKASSA_REFUND_ID_METADATA_KEY = "yookassa_refund_id"

type RefundRow = {
  id: string
  amount: BigNumberInput
  metadata?: Record<string, unknown> | null
}

type PaymentWithRefunds = Omit<
  Awaited<ReturnType<IPaymentModuleService["retrievePayment"]>>,
  "refunds"
> & {
  refunds?: RefundRow[]
}

type PaymentServiceWithRefundCrud = IPaymentModuleService & {
  createRefunds(input: Record<string, unknown>): Promise<RefundRow>
  updateRefunds(input: Record<string, unknown>): Promise<RefundRow>
}

type ProviderPayment = {
  id?: unknown
  amount?: { value?: unknown; currency?: unknown }
  refunded_amount?: { value?: unknown; currency?: unknown } | null
}

type ProviderRefundedAmount = {
  value: string | number
  currency: string
}

function failClosed(message: string): never {
  throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)
}

function providerPayment(data: Record<string, unknown>): ProviderPayment {
  return data as ProviderPayment
}

function isFiniteAmount(value: unknown): value is string | number {
  if (typeof value === "number") return Number.isFinite(value)
  return typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
}

function verifiedRefundedAmount(
  data: Record<string, unknown>,
  currencyCode: string,
  maximumAmount: BigNumberInput
): ProviderRefundedAmount | undefined {
  const value = (data as ProviderPayment).refunded_amount
  if (value == null) return undefined
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    !isFiniteAmount(value.value) ||
    typeof value.currency !== "string" ||
    !MathBN.gte(value.value, 0) ||
    !MathBN.gte(maximumAmount, value.value) ||
    value.currency.toLowerCase() !== currencyCode.toLowerCase()
  ) {
    return failClosed("Сумма возврата в данных ЮKassa некорректна")
  }
  return {
    value: value.value,
    currency: value.currency,
  }
}

function monotonicRefundedAmount(
  currentData: Record<string, unknown>,
  verifiedData: Record<string, unknown>,
  currencyCode: string,
  maximumAmount: BigNumberInput
) {
  const current = verifiedRefundedAmount(
    currentData,
    currencyCode,
    maximumAmount
  )
  const verified = verifiedRefundedAmount(
    verifiedData,
    currencyCode,
    maximumAmount
  )
  if (!current) return verified
  if (!verified) return current
  return MathBN.gte(current.value, verified.value) ? current : verified
}

function validateRefundTransactions(
  transactions: Array<{ amount: BigNumberInput; currency_code: string }>,
  amount: string,
  currencyCode: string
) {
  if (transactions.length > 1) {
    return failClosed("Для локального возврата найдено несколько транзакций заказа")
  }
  if (
    transactions[0] &&
    (!MathBN.eq(transactions[0].amount, -Number(amount)) ||
      transactions[0].currency_code.toLowerCase() !== currencyCode.toLowerCase())
  ) {
    return failClosed("Транзакция заказа не совпадает с подтверждённым возвратом")
  }
}

type RefundPlan = {
  refunds?: Array<{ payment_id?: unknown }>
}

async function reconcileOrderRefundMetadata(
  container: MedusaContainer,
  orderId: string
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "metadata",
      "payment_collections.payments.currency_code",
      "payment_collections.payments.captures.amount",
      "payment_collections.payments.refunds.amount",
    ],
    filters: { id: orderId },
  })
  const order = data[0] as
    | {
        metadata?: Record<string, unknown> | null
        payment_collections?: Array<{
          payments?: Array<{
            currency_code?: string
            captures?: Array<{ amount?: BigNumberInput }>
            refunds?: Array<{ amount?: BigNumberInput }>
          }>
        }>
      }
    | undefined
  if (!order) return

  const metadata = order.metadata ?? {}
  const requestId = metadata.catalog_refund_request_id
  const plansValue = metadata.catalog_refund_plans
  if (typeof requestId !== "string" || typeof plansValue !== "string") return

  let parsedPlans: unknown
  try {
    parsedPlans = JSON.parse(plansValue)
  } catch {
    return
  }
  if (
    !parsedPlans ||
    typeof parsedPlans !== "object" ||
    Array.isArray(parsedPlans)
  ) {
    return
  }
  const plans = parsedPlans as Record<string, RefundPlan>
  const plan = plans[requestId]
  if (!Array.isArray(plan?.refunds) || !plan.refunds.length) return

  const expectedKeys = plan.refunds.map((refund) =>
    typeof refund.payment_id === "string"
      ? `refund-request:${requestId}:${refund.payment_id}`
      : null
  )
  if (expectedKeys.some((key) => key === null)) return

  const operations = container.resolve<PaymentOperationModuleService>(
    PAYMENT_OPERATION_MODULE
  )
  const requestOperations = await operations.listPaymentOperations({
    type: "refund",
    order_id: orderId,
  })
  for (const key of expectedKeys as string[]) {
    const matches = requestOperations.filter(
      (operation) => operation.idempotency_key === key
    )
    if (
      matches.length !== 1 ||
      matches[0].state !== "completed" ||
      !matches[0].result_reflected_at
    ) {
      return
    }
  }

  const payments = (order.payment_collections ?? []).flatMap(
    (collection) => collection.payments ?? []
  )
  const currencies = new Set(
    payments
      .map((payment) => payment.currency_code?.toLowerCase())
      .filter((currency): currency is string => Boolean(currency))
  )
  if (currencies.size > 1) return

  const captured = payments.reduce(
    (total, payment) =>
      (payment.captures ?? []).reduce(
        (sum, capture) => MathBN.add(sum, capture.amount ?? 0),
        total
      ),
    MathBN.convert(0)
  )
  const refunded = payments.reduce(
    (total, payment) =>
      (payment.refunds ?? []).reduce(
        (sum, refund) => MathBN.add(sum, refund.amount ?? 0),
        total
      ),
    MathBN.convert(0)
  )
  if (!MathBN.gt(captured, 0)) return

  const status = MathBN.gte(refunded, captured) ? "refunded" : "partial"
  const errorKey = "catalog_refund_error"
  const statusKey = "catalog_refund_status"
  if (metadata[statusKey] === status && metadata[errorKey] == null) return

  const orderModule = container.resolve(
    Modules.ORDER
  ) as IOrderModuleService
  await orderModule.updateOrders(orderId, {
    metadata: {
      ...metadata,
      [statusKey]: status,
      [errorKey]: null,
      catalog_refund_updated_at: new Date().toISOString(),
    },
  })
}

export async function reconcileCatalogRefundWebhook(
  container: MedusaContainer,
  input: VerifiedCatalogRefundWebhook
) {
  const paymentModule = container.resolve(
    Modules.PAYMENT
  ) as PaymentServiceWithRefundCrud
  const orderModule = container.resolve(
    Modules.ORDER
  ) as IOrderModuleService
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const operations = container.resolve<PaymentOperationModuleService>(
    PAYMENT_OPERATION_MODULE
  )

  const session = await paymentModule.retrievePaymentSession(
    input.payment_session_id,
    { relations: ["payment"] }
  )
  if (
    session.provider_id !== "pp_yookassa_yookassa" ||
    session.data?.id !== input.payment_id ||
    !session.payment
  ) {
    return failClosed("ЮKassa refund не связан с платёжной сессией Medusa")
  }

  const paymentOperationId = session.data?.payment_operation_id
  if (typeof paymentOperationId !== "string" || !paymentOperationId) {
    return failClosed("Для платежа ЮKassa не найдена операция оплаты Medusa")
  }

  const paymentOperations = await operations.listPaymentOperations({
    type: "payment",
    provider_id: "yookassa",
    provider_operation_id: input.payment_id,
  })
  if (
    paymentOperations.length !== 1 ||
    paymentOperations[0].id !== paymentOperationId ||
    paymentOperations[0].state !== "completed"
  ) {
    return failClosed(
      "Связь платежа ЮKassa с завершённой операцией Medusa неоднозначна"
    )
  }

  const paymentId = session.payment.id

  return locking.execute(
    `catalog-yookassa-refund:${paymentId}`,
    async () => {
  const payment = (await paymentModule.retrievePayment(paymentId, {
    relations: ["refunds"],
  })) as PaymentWithRefunds
  const remotePayment = providerPayment(input.payment_data)
  if (
    payment.provider_id !== session.provider_id ||
    payment.currency_code.toLowerCase() !== session.currency_code.toLowerCase() ||
    paymentOperations[0].currency_code.toLowerCase() !==
      payment.currency_code.toLowerCase() ||
    !MathBN.eq(payment.amount, session.amount) ||
    !MathBN.eq(paymentOperations[0].amount, session.amount) ||
    remotePayment.id !== input.payment_id ||
    typeof remotePayment.amount?.value !== "string" ||
    !MathBN.eq(remotePayment.amount.value, session.amount) ||
    typeof remotePayment.amount.currency !== "string" ||
    remotePayment.amount.currency.toLowerCase() !==
      session.currency_code.toLowerCase()
  ) {
    return failClosed("Сумма или валюта платежа ЮKassa не совпадает с Medusa")
  }

  if (
    input.currency_code !== payment.currency_code.toLowerCase() ||
    !MathBN.gt(input.amount, 0)
  ) {
    return failClosed("Сумма или валюта возврата ЮKassa не совпадает с Medusa")
  }

  const previousData = (payment.data ?? {}) as Record<string, unknown>
  // Validate before creating or updating any local refund records. A verified
  // but malformed provider snapshot must not reconcile into Medusa.
  const refundedAmount = monotonicRefundedAmount(
    previousData,
    input.payment_data,
    payment.currency_code,
    payment.amount
  )

  const refundOperations = await operations.listPaymentOperations({
    type: "refund",
    original_payment_id: payment.id,
  })
  const amountAndCurrencyMatches = refundOperations.filter(
    (operation) =>
      operation.provider_id === payment.provider_id &&
      MathBN.eq(operation.amount, input.amount) &&
      operation.currency_code.toLowerCase() === input.currency_code
  )

  // Amount is only a safe fallback when it identifies one operation. Once an
  // external YooKassa refund ID has been stored, use that exact correlation so
  // two sequential partial refunds of the same amount remain distinguishable.
  const refundsWithProviderId = (payment.refunds ?? []).filter(
    (refund) =>
      refund.metadata?.[YOOKASSA_REFUND_ID_METADATA_KEY] === input.refund_id
  )
  if (refundsWithProviderId.length > 1) {
    return failClosed("Для refund ID ЮKassa найдено несколько локальных возвратов")
  }

  const exactOperationIds = new Set<string>()
  const exactProviderOperations = refundOperations.filter(
    (operation) => operation.provider_operation_id === input.refund_id
  )
  if (exactProviderOperations.length > 1) {
    return failClosed("Refund ID ЮKassa связан с несколькими операциями Medusa")
  }
  if (exactProviderOperations[0]) {
    exactOperationIds.add(exactProviderOperations[0].id)
  }
  if (refundsWithProviderId[0]) {
    const operationId = refundsWithProviderId[0].metadata?.[
      CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY
    ]
    if (typeof operationId !== "string" || !operationId) {
      return failClosed("Локальный возврат ЮKassa не связан с операцией Medusa")
    }
    exactOperationIds.add(operationId)
  }

  let matchingOperations = amountAndCurrencyMatches
  if (exactOperationIds.size > 1) {
    return failClosed("Refund ID ЮKassa противоречиво связан с операциями Medusa")
  }
  if (exactOperationIds.size === 1) {
    const exactOperationId = [...exactOperationIds][0]
    matchingOperations = amountAndCurrencyMatches.filter(
      (operation) => operation.id === exactOperationId
    )
    if (matchingOperations.length !== 1) {
      return failClosed(
        "Точная связь refund ID ЮKassa не совпадает с платежом, суммой или валютой Medusa"
      )
    }
  }

  // A completed equal-amount operation is not an unresolved candidate when
  // its own local Refund row proves it belongs to a different YooKassa refund.
  // Require both sides of that relationship; never infer from amount alone.
  // Keep the exact operation for this webhook even if it is already completed.
  const exactOperationId =
    exactOperationIds.size === 1 ? [...exactOperationIds][0] : null
  const completedRefundsBoundElsewhere = new Set<string>()
  for (const operation of amountAndCurrencyMatches) {
    if (
      operation.id === exactOperationId ||
      operation.state !== "completed" ||
      !operation.provider_operation_id
    ) {
      continue
    }

    const linkedRefunds = (payment.refunds ?? []).filter(
      (refund) =>
        refund.metadata?.[CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY] ===
        operation.id
    )
    if (linkedRefunds.length > 1) {
      return failClosed(
        "Для завершённой операции найдено несколько локальных возвратов"
      )
    }
    const linkedRefund = linkedRefunds[0]
    if (!linkedRefund) continue
    if (!MathBN.eq(linkedRefund.amount, operation.amount)) {
      return failClosed(
        "Локальный возврат завершённой операции имеет другую сумму"
      )
    }

    const linkedProviderRefundId =
      linkedRefund.metadata?.[YOOKASSA_REFUND_ID_METADATA_KEY]
    const providerOperationId = operation.provider_operation_id
    if (
      typeof linkedProviderRefundId !== "string" ||
      !linkedProviderRefundId
    ) {
      // The operation ID may still be the Medusa Refund ID, but without the
      // external ID there is no proof that this completion belongs elsewhere.
      if (providerOperationId !== linkedRefund.id) {
        return failClosed(
          "ID провайдера завершённой операции не подтверждён локальным возвратом"
        )
      }
      continue
    }
    if (
      providerOperationId !== linkedRefund.id &&
      providerOperationId !== linkedProviderRefundId
    ) {
      return failClosed(
        "ID провайдера завершённой операции противоречит локальному возврату"
      )
    }
    if (linkedProviderRefundId !== input.refund_id) {
      completedRefundsBoundElsewhere.add(operation.id)
    }
  }
  if (completedRefundsBoundElsewhere.size) {
    matchingOperations = matchingOperations.filter(
      (operation) => !completedRefundsBoundElsewhere.has(operation.id)
    )
  }

  if (matchingOperations.length !== 1) {
    return failClosed(
      "Невозможно однозначно сопоставить возврат ЮKassa с операцией возврата Medusa"
    )
  }

  const [refundOperation] = matchingOperations
  const orderId = refundOperation.order_id
  if (!orderId) {
    return failClosed("Операция возврата Medusa не связана с заказом")
  }

  const correlatedRefunds = (payment.refunds ?? []).filter(
    (refund) =>
      refund.metadata?.[CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY] ===
      refundOperation.id
  )
  if (correlatedRefunds.length > 1) {
    return failClosed("Для операции возврата найдено несколько локальных записей")
  }

  let localRefund = correlatedRefunds[0]
  if (localRefund && !MathBN.eq(localRefund.amount, input.amount)) {
    return failClosed("Сумма локального возврата не совпадает с ЮKassa")
  }
  if (
    localRefund?.metadata?.[YOOKASSA_REFUND_ID_METADATA_KEY] &&
    localRefund.metadata[YOOKASSA_REFUND_ID_METADATA_KEY] !== input.refund_id
  ) {
    return failClosed("Локальный возврат уже связан с другим refund ID ЮKassa")
  }

  if (refundOperation.state === "declined_final") {
    return failClosed(
      "Успешный возврат ЮKassa противоречит финальному отказу операции Medusa"
    )
  }
  if (
    refundOperation.state !== "completed" &&
    !["processing", "retry_pending", "result_unknown"].includes(
      refundOperation.state
    )
  ) {
    return failClosed("Операция возврата Medusa не может быть завершена вебхуком")
  }
  const existingProviderOperationId = refundOperation.provider_operation_id
  if (
    existingProviderOperationId &&
    existingProviderOperationId !== localRefund?.id &&
    existingProviderOperationId !== input.refund_id
  ) {
    return failClosed("Операция возврата связана с другим ID провайдера")
  }

  if (localRefund) {
    const existingTransactions = (await orderModule.listOrderTransactions({
        order_id: orderId,
        reference: "refund",
        reference_id: localRefund.id,
    })) as Array<{ amount: BigNumberInput; currency_code: string }>
    validateRefundTransactions(
      existingTransactions,
      input.amount,
      payment.currency_code
    )
  }
  const priorEventAttempts = await operations.listPaymentOperationAttempts({
    external_event_key: `yookassa:refund:${input.refund_id}`,
  })
  if (
    priorEventAttempts.some(
      (attempt) => attempt.operation_id !== refundOperation.id
    )
  ) {
    return failClosed("Webhook refund ID уже связан с другой операцией Medusa")
  }

  if (!localRefund) {
    localRefund = await paymentModule.createRefunds({
      payment_id: payment.id,
      amount: input.amount,
      metadata: {
        [CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY]: refundOperation.id,
        [YOOKASSA_REFUND_ID_METADATA_KEY]: input.refund_id,
      },
    })
  } else if (
    localRefund.metadata?.[YOOKASSA_REFUND_ID_METADATA_KEY] !== input.refund_id
  ) {
    localRefund = await paymentModule.updateRefunds({
      id: localRefund.id,
      metadata: {
        ...(localRefund.metadata ?? {}),
        [YOOKASSA_REFUND_ID_METADATA_KEY]: input.refund_id,
      },
    })
  }
  const refundToReflect = localRefund
  if (!refundToReflect) {
    return failClosed("Локальный возврат Medusa не создан")
  }

  const previousRefunds = Array.isArray(previousData.yookassa_refunds)
    ? (previousData.yookassa_refunds as Array<Record<string, unknown>>)
    : []
  const reconciledRefund = {
    id: input.refund_id,
    payment_id: input.payment_id,
    amount: input.amount,
    currency: input.currency_code.toUpperCase(),
    status: "succeeded",
  }
  const refundHistory = [
    ...previousRefunds.filter((refund) => refund.id !== input.refund_id),
    reconciledRefund,
  ]
  // Webhook verification fetches the YooKassa payment before this workflow
  // acquires the per-payment lock. Preserve a newer refunded_amount written
  // by an admin refund while that snapshot was waiting for the lock.
  await paymentModule.updatePayment({
    id: payment.id,
    data: {
      ...previousData,
      ...input.payment_data,
      ...(refundedAmount ? { refunded_amount: refundedAmount } : {}),
      yookassa_refunds: refundHistory,
      last_yookassa_refund: reconciledRefund,
    },
  } as never)

  await locking.execute(
    `catalog-order-refund-ledger:${orderId}:${refundToReflect.id}`,
    async () => {
      // Both the admin refund and this webhook use the same lock. Re-read
      // after acquiring it, because the earlier validation is only preflight.
      const transactions = (await orderModule.listOrderTransactions({
        order_id: orderId,
        reference: "refund",
        reference_id: refundToReflect.id,
      })) as Array<{ amount: BigNumberInput; currency_code: string }>
      validateRefundTransactions(transactions, input.amount, payment.currency_code)
      if (!transactions.length) {
        await orderModule.addOrderTransactions({
          order_id: orderId,
          amount: -Number(input.amount),
          currency_code: payment.currency_code,
          reference: "refund",
          reference_id: refundToReflect.id,
        })
      }
    },
    { timeout: 120 }
  )

  if (refundOperation.state === "completed") {
    if (existingProviderOperationId !== input.refund_id) {
      await operations.updatePaymentOperations({
        id: refundOperation.id,
        provider_operation_id: input.refund_id,
      })
    }
  } else {
    try {
      await operations.transitionPaymentOperation({
        operation_id: refundOperation.id,
        to_state: "completed",
        source: "reconciliation",
        action: "refund_webhook_succeeded",
        result: "refunded",
        provider_operation_id: input.refund_id,
        external_event_key: `yookassa:refund:${input.refund_id}`,
      })
    } catch (error) {
      // The synchronous admin refund and this webhook can race to finalize the
      // same operation. Accept only a completion carrying this exact local or
      // provider refund correlation; otherwise preserve the failure.
      const current = await operations.retrievePaymentOperation(
        refundOperation.id
      )
      if (
        current.state !== "completed" ||
        (current.provider_operation_id !== refundToReflect.id &&
          current.provider_operation_id !== input.refund_id)
      ) {
        throw error
      }
      if (current.provider_operation_id !== input.refund_id) {
        await operations.updatePaymentOperations({
          id: refundOperation.id,
          provider_operation_id: input.refund_id,
        })
      }
    }
  }

  await operations.markPaymentOperationResultReflected({
    operation_id: refundOperation.id,
    order_id: orderId,
  })
  await reconcileOrderRefundMetadata(container, orderId)

  return {
    refund_id: input.refund_id,
    payment_id: payment.id,
    operation_id: refundOperation.id,
    local_refund_id: refundToReflect.id,
    order_id: orderId,
  }
    },
    { timeout: 300 }
  )
}

export const reconcileCatalogRefundWebhookStep = createStep(
  "reconcile-catalog-refund-webhook",
  async (input: VerifiedCatalogRefundWebhook, { container }) =>
    new StepResponse(await reconcileCatalogRefundWebhook(container, input))
)
