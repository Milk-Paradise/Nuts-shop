import type {
  BigNumberInput,
  ILockingModule,
  IOrderModuleService,
  IPaymentModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { MathBN, MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PAYMENT_OPERATION_MODULE } from "../../modules/payment-operation"
import type PaymentOperationModuleService from "../../modules/payment-operation/service"

export const CATALOG_REFUND_STATUS_METADATA_KEY = "catalog_refund_status"
export const CATALOG_REFUND_ERROR_METADATA_KEY = "catalog_refund_error"
export const CATALOG_REFUND_UPDATED_AT_METADATA_KEY =
  "catalog_refund_updated_at"
export const CATALOG_REFUND_REQUEST_ID_METADATA_KEY = "catalog_refund_request_id"
export const CATALOG_REFUND_REQUEST_AMOUNT_METADATA_KEY =
  "catalog_refund_request_amount"
export const CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY =
  "catalog_payment_operation_id"
export const YOOKASSA_REFUND_ID_METADATA_KEY = "yookassa_refund_id"

type CatalogRefundInput = {
  order_id: string
  refunds: Array<{
    payment_id: string
    amount: number
    currency_code: string
    created_by?: string
    note?: string
    idempotency_key?: string
  }>
  refund_request_id?: string
  requested_amount?: number
}

function errorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Неизвестная ошибка возврата"

  return message.trim().slice(0, 2000) || "Неизвестная ошибка возврата"
}

async function updateRefundMetadata(
  orderModule: IOrderModuleService,
  input: CatalogRefundInput,
  status: "refunded" | "partial" | "error",
  error: string | null
) {
  const order = await orderModule.retrieveOrder(input.order_id, {
    select: ["metadata"],
  })

  await orderModule.updateOrders(input.order_id, {
    metadata: {
      ...(order.metadata ?? {}),
      [CATALOG_REFUND_STATUS_METADATA_KEY]: status,
      [CATALOG_REFUND_ERROR_METADATA_KEY]: error,
      [CATALOG_REFUND_UPDATED_AT_METADATA_KEY]: new Date().toISOString(),
    },
  })
}

async function addRefundTransaction(
  locking: ILockingModule,
  orderModule: IOrderModuleService,
  input: CatalogRefundInput,
  refund: { id: string; amount: unknown },
  currencyCode: string
) {
  return locking.execute(
    `catalog-order-refund-ledger:${input.order_id}:${refund.id}`,
    async () => {
      const existing = await orderModule.listOrderTransactions({
        order_id: input.order_id,
        reference: "refund",
        reference_id: refund.id,
      })

      if (existing.length) return

      await orderModule.addOrderTransactions({
        order_id: input.order_id,
        amount: -Number(refund.amount),
        currency_code: currencyCode,
        reference: "refund",
        reference_id: refund.id,
      })
    }
  )
}

async function reconcileRefundTransactions(
  locking: ILockingModule,
  paymentModule: IPaymentModuleService,
  orderModule: IOrderModuleService,
  input: CatalogRefundInput,
  refund: CatalogRefundInput["refunds"][number],
  paymentResult?: PaymentWithRefundMetadata
) {
  const payment =
    paymentResult ??
    (await paymentModule.retrievePayment(refund.payment_id, {
      relations: ["refunds"],
    }))

  for (const completedRefund of payment.refunds ?? []) {
    await addRefundTransaction(
      locking,
      orderModule,
      input,
      completedRefund,
      refund.currency_code
    )
  }
}

function refundProviderOperationId(
  payment: PaymentWithRefundMetadata,
  operationId: string
) {
  const matching = paymentRefunds(payment).filter(
    (refund) =>
      refund.metadata?.[CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY] ===
      operationId
  )

  if (matching.length !== 1 || !matching[0]) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "После возврата не найдена однозначная локальная запись; требуется сверка"
    )
  }

  const refund = matching[0]
  const providerRefundId = refund.metadata?.[YOOKASSA_REFUND_ID_METADATA_KEY]
  if (typeof providerRefundId === "string" && providerRefundId) {
    const typedPayment = payment as PaymentWithRefundMetadata
    recoveredRefund(
      typedPayment,
      operationId,
      refund.amount,
      typedPayment.currency_code
    )
    return providerRefundId
  }

  return refund.id
}

type PaymentWithRefundMetadata = Omit<
  Awaited<ReturnType<IPaymentModuleService["retrievePayment"]>>,
  "refunds"
> & {
  refunds?: Array<{
    id: string
    amount: BigNumberInput
    metadata?: Record<string, unknown> | null
  }>
}

function paymentRefunds(payment: PaymentWithRefundMetadata) {
  return payment.refunds ?? []
}

function recoveredRefund(
  payment: PaymentWithRefundMetadata,
  operationId: string,
  expectedAmount: BigNumberInput,
  expectedCurrency: string
) {
  const matching = paymentRefunds(payment).filter(
    (refund) =>
      refund.metadata?.[CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY] ===
      operationId
  )

  if (!matching.length) return null

  if (matching.length !== 1 || !matching[0]) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Найдено несколько возвратов для одной платёжной операции; требуется сверка"
    )
  }

  const refund = matching[0]
  if (!MathBN.eq(refund.amount, expectedAmount)) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Сумма сохранённого возврата не совпадает с платёжной операцией; требуется сверка"
    )
  }

  if (payment.currency_code.toLowerCase() !== expectedCurrency.toLowerCase()) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Валюта сохранённого возврата не совпадает с платёжной операцией; требуется сверка"
    )
  }

  const data = payment.data as
    | {
        refunded_amount?: { value?: unknown; currency?: unknown } | null
        yookassa_refunds?: Array<{
          id?: unknown
          status?: unknown
          amount?: unknown
          currency?: unknown
        }> | null
      }
    | null
    | undefined
  const yookassaRefundId = refund.metadata?.[YOOKASSA_REFUND_ID_METADATA_KEY]
  const remoteRefunds = data?.yookassa_refunds ?? []
  const matchingRemoteRefunds =
    typeof yookassaRefundId === "string"
      ? remoteRefunds.filter((remoteRefund) => remoteRefund.id === yookassaRefundId)
      : []

  if (
    typeof yookassaRefundId !== "string" ||
    !yookassaRefundId ||
    matchingRemoteRefunds.length > 1 ||
    (matchingRemoteRefunds.length === 1 &&
      (matchingRemoteRefunds[0]?.status !== "succeeded" ||
        typeof matchingRemoteRefunds[0]?.amount !== "string" ||
        !MathBN.eq(matchingRemoteRefunds[0].amount, expectedAmount) ||
        typeof matchingRemoteRefunds[0]?.currency !== "string" ||
        matchingRemoteRefunds[0].currency.toLowerCase() !==
          expectedCurrency.toLowerCase()))
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Нет подтверждения точного возврата ЮKassa; требуется сверка"
    )
  }

  const remoteRefundedAmount = data?.refunded_amount?.value
  const remoteRefundedCurrency = data?.refunded_amount?.currency

  if (
    (typeof remoteRefundedAmount !== "string" &&
      typeof remoteRefundedAmount !== "number") ||
    typeof remoteRefundedCurrency !== "string" ||
    remoteRefundedCurrency.toLowerCase() !== expectedCurrency.toLowerCase()
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "В данных платёжного провайдера нет подтверждённой суммы возврата; требуется сверка"
    )
  }

  const localRefundedAmount = paymentRefunds(payment).reduce(
    (total, current) => MathBN.add(total, current.amount),
    MathBN.convert(0)
  )

  if (!MathBN.gte(remoteRefundedAmount as BigNumberInput, localRefundedAmount)) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Сумма возвратов в платёжном провайдере меньше локальной; требуется сверка"
    )
  }

  return refund
}

function operationRefundForPayment(
  payment: PaymentWithRefundMetadata,
  operationId: string,
  expectedAmount: number,
  expectedCurrency: string
) {
  const matching = paymentRefunds(payment).filter(
    (refund) =>
      refund.metadata?.[CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY] ===
      operationId
  )

  if (matching.length !== 1 || !matching[0]) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Завершённая операция возврата не связана с одной локальной записью"
    )
  }

  const refund = matching[0]
  if (
    !MathBN.eq(refund.amount, expectedAmount) ||
    payment.currency_code.toLowerCase() !== expectedCurrency.toLowerCase()
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Завершённая операция возврата имеет другую сумму или валюту"
    )
  }

  return refund
}

function completedOperationMatchesRefund(
  operation: { provider_operation_id?: string | null },
  payment: PaymentWithRefundMetadata,
  operationId: string,
  expectedAmount: number,
  expectedCurrency: string
) {
  const refund = operationRefundForPayment(
    payment,
    operationId,
    expectedAmount,
    expectedCurrency
  )
  const yookassaRefundId = refund.metadata?.[YOOKASSA_REFUND_ID_METADATA_KEY]
  const providerOperationId = operation.provider_operation_id

  if (providerOperationId === refund.id) return refund
  if (
    typeof yookassaRefundId === "string" &&
    providerOperationId === yookassaRefundId
  ) {
    recoveredRefund(payment, operationId, expectedAmount, expectedCurrency)
    return refund
  }

  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "Завершённая операция возврата связана с другим возвратом; требуется сверка"
  )
}

async function completeRefundOperation(
  operations: PaymentOperationModuleService,
  paymentModule: IPaymentModuleService,
  refund: CatalogRefundInput["refunds"][number],
  operationId: string,
  payment: PaymentWithRefundMetadata,
  transition: {
    source: "provider" | "reconciliation"
    action: string
    result: string
  }
) {
  const current = await operations.retrievePaymentOperation(operationId)
  if (current.state === "completed") {
    const latestPayment = (await paymentModule.retrievePayment(
      refund.payment_id,
      { relations: ["refunds"] }
    )) as PaymentWithRefundMetadata
    completedOperationMatchesRefund(
      current,
      latestPayment,
      operationId,
      refund.amount,
      refund.currency_code
    )
    return latestPayment
  }

  const providerOperationId = refundProviderOperationId(
    payment,
    operationId
  )
  try {
    await operations.transitionPaymentOperation({
      operation_id: operationId,
      to_state: "completed",
      source: transition.source,
      action: transition.action,
      result: transition.result,
      provider_operation_id: providerOperationId,
    })
    return payment
  } catch (error) {
    const concurrent = await operations.retrievePaymentOperation(operationId)
    if (concurrent.state !== "completed") throw error

    const latestPayment = (await paymentModule.retrievePayment(
      refund.payment_id,
      { relations: ["refunds"] }
    )) as PaymentWithRefundMetadata
    completedOperationMatchesRefund(
      concurrent,
      latestPayment,
      operationId,
      refund.amount,
      refund.currency_code
    )
    return latestPayment
  }
}

export async function executeCatalogOrderRefund(
  container: MedusaContainer,
  input: CatalogRefundInput
) {
  const paymentModule = container.resolve(
    Modules.PAYMENT
  ) as IPaymentModuleService
  const orderModule = container.resolve(Modules.ORDER) as IOrderModuleService
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const operations = container.resolve<PaymentOperationModuleService>(
    PAYMENT_OPERATION_MODULE
  )

  try {
    const completedOperationIds: string[] = []
    for (const refund of input.refunds) {
      const completedOperationId = await locking.execute(
        `catalog-yookassa-refund:${refund.payment_id}`,
        async () => {
      const paymentBeforeClaim = (await paymentModule.retrievePayment(
        refund.payment_id,
        { relations: ["refunds"] }
      )) as PaymentWithRefundMetadata
      const idempotencyKey =
        refund.idempotency_key ??
        (input.refund_request_id
          ? `refund-request:${input.refund_request_id}:${refund.payment_id}`
          : `payment-action:${refund.payment_id}`)
      const paymentRefundOperations = await operations.listPaymentOperations({
        type: "refund",
        original_payment_id: refund.payment_id,
      })
      const unresolvedOperations = paymentRefundOperations.filter(
        (operation) =>
          operation.idempotency_key !== idempotencyKey &&
          ["processing", "retry_pending", "result_unknown"].includes(
            operation.state
          )
      )
      if (unresolvedOperations.length) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Для этого платежа уже есть незавершённый возврат; требуется сверка до нового запроса"
        )
      }
      const unboundSameAmountRefunds = paymentRefundOperations.filter(
        (operation) =>
          operation.idempotency_key !== idempotencyKey &&
          operation.state === "completed" &&
          MathBN.eq(operation.amount, refund.amount) &&
          !recoveredRefund(
            paymentBeforeClaim,
            operation.id,
            operation.amount,
            operation.currency_code
          )
      )
      if (unboundSameAmountRefunds.length) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Есть завершённый возврат той же суммы без ID ЮKassa; дождитесь webhook или выполните сверку"
        )
      }
      const claimed = await operations.claimPaymentOperation({
        type: "refund",
        original_payment_id: refund.payment_id,
        provider_id: paymentBeforeClaim.provider_id,
        order_id: input.order_id,
        amount: refund.amount,
        currency_code: refund.currency_code,
        idempotency_key: idempotencyKey,
        action: "refund",
      })
      if (claimed.operation.state !== "completed") {
        const paymentRefundOperations = await operations.listPaymentOperations({
          type: "refund",
          original_payment_id: refund.payment_id,
        })
        const otherUnresolvedOperations = paymentRefundOperations.filter(
          (operation) =>
            operation.id !== claimed.operation.id &&
            ["processing", "retry_pending", "result_unknown"].includes(
              operation.state
            )
        )
        if (otherUnresolvedOperations.length) {
          if (claimed.created) {
            await operations.transitionPaymentOperation({
              operation_id: claimed.operation.id,
              to_state: "declined_final",
              source: "provider",
              action: "refund_blocked_by_unresolved_operation",
              result: "declined",
              error_reason:
                "Another refund operation for this payment is unresolved",
            })
          }
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            "Для этого платежа уже есть незавершённый возврат; требуется сверка до нового запроса"
          )
        }
      }
      let payment: PaymentWithRefundMetadata

      if (claimed.operation.state === "completed") {
        completedOperationMatchesRefund(
          claimed.operation,
          paymentBeforeClaim,
          claimed.operation.id,
          refund.amount,
          refund.currency_code
        )
        payment = paymentBeforeClaim
      } else {
        if (
          claimed.operation.state !== "processing" &&
          claimed.operation.state !== "retry_pending" &&
          claimed.operation.state !== "result_unknown"
        ) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "Возврат не может быть повторён в текущем состоянии операции"
          )
        }
        const transitionSource =
          claimed.operation.state === "result_unknown"
            ? ("reconciliation" as const)
            : ("provider" as const)

        const recovered = claimed.created
          ? null
          : recoveredRefund(
              paymentBeforeClaim,
              claimed.operation.id,
              refund.amount,
              refund.currency_code
            )

        if (recovered) {
          payment = await completeRefundOperation(
            operations,
            paymentModule,
            refund,
            claimed.operation.id,
            paymentBeforeClaim,
            {
              source: "reconciliation",
              action: "refund_reconciled",
              result: "refunded",
            }
          )
        } else {
          if (
            !claimed.created &&
            ["processing", "retry_pending", "result_unknown"].includes(
              claimed.operation.state
            )
          ) {
            throw new MedusaError(
              MedusaError.Types.UNEXPECTED_STATE,
              "Операция возврата не подтверждена точной записью ЮKassa; требуется сверка, повтор запрещён"
            )
          }

          try {
            payment = refund.amount
              ? await paymentModule.refundPayment({
                  payment_id: refund.payment_id,
                  amount: refund.amount,
                  created_by: refund.created_by,
                  note: refund.note,
                  metadata: {
                    [CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY]:
                      claimed.operation.id,
                  },
                })
              : await paymentModule.retrievePayment(refund.payment_id, {
                  relations: ["refunds"],
                })
          } catch (error) {
            await operations.transitionPaymentOperation({
              operation_id: claimed.operation.id,
              to_state: "result_unknown",
              source: transitionSource,
              action: "refund",
              result: "error",
              error_category: "provider_error",
              error_reason: errorMessage(error),
            })
            throw error
          }

          payment = await completeRefundOperation(
            operations,
            paymentModule,
            refund,
            claimed.operation.id,
            payment as PaymentWithRefundMetadata,
            {
              source: transitionSource,
              action: "refund",
              result: "refunded",
            }
          )
        }
      }

      await reconcileRefundTransactions(
        locking,
        paymentModule,
        orderModule,
        input,
        refund,
        payment
      )
      return claimed.operation.id
        },
        { timeout: 300 }
      )
      completedOperationIds.push(completedOperationId)
    }

    await updateRefundMetadata(
      orderModule,
      input,
      input.requested_amount === undefined ? "refunded" : "partial",
      null
    )
    for (const operationId of completedOperationIds) {
      await operations.markPaymentOperationResultReflected({
        operation_id: operationId,
        order_id: input.order_id,
      })
    }
    return { status: "refunded" as const, error: null }
  } catch (error) {
    const message = errorMessage(error)
    await updateRefundMetadata(orderModule, input, "error", message)
    return { status: "error" as const, error: message }
  }
}

export const executeCatalogOrderRefundStep = createStep(
  "execute-catalog-order-refund",
  async (input: CatalogRefundInput, { container }) =>
    new StepResponse(await executeCatalogOrderRefund(container, input))
)
