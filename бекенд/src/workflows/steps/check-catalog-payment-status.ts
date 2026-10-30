import type {
  BigNumberInput,
  IPaymentModuleService,
  PaymentDTO,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MathBN,
  MedusaError,
  Modules,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

import { describeProviderError } from "../../providers/payment-yookassa-runtime/errors"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PAYMENT_OPERATION_MODULE } from "../../modules/payment-operation"
import type PaymentOperationModuleService from "../../modules/payment-operation/service"

type PaymentProviderStatusService = {
  getStatus(
    providerId: string,
    input: { data: Record<string, unknown> }
  ): Promise<{
    status: PaymentSessionStatus
    data: Record<string, unknown>
  }>
}

type PaymentModuleWithProviderService = IPaymentModuleService & {
  paymentProviderService_: PaymentProviderStatusService
}

export type CatalogPaymentCheckResult = {
  status: "pending" | "failed" | "succeeded"
  operation_id: string
  payment: {
    id: string
    currency_code: string
    captures: Array<{ id: string; amount: BigNumberInput }>
  } | null
}

function providerPaymentData(data: Record<string, unknown>) {
  return data as {
    id?: unknown
    amount?: { value?: unknown; currency?: unknown }
  }
}

function assertProviderPaymentMatchesSession(
  providerData: Record<string, unknown>,
  session: Awaited<ReturnType<IPaymentModuleService["retrievePaymentSession"]>>
) {
  const payment = providerPaymentData(providerData)
  const expectedProviderPaymentId = session.data?.id
  const amount = payment.amount?.value

  if (
    typeof expectedProviderPaymentId !== "string" ||
    payment.id !== expectedProviderPaymentId ||
    (typeof amount !== "string" && typeof amount !== "number") ||
    !MathBN.eq(amount, session.amount) ||
    String(payment.amount?.currency ?? "").toLowerCase() !==
      session.currency_code.toLowerCase()
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Данные платежа ЮKassa не совпадают с платёжной сессией"
    )
  }
}

function paymentResult(
  payment: PaymentDTO,
  operationId: string
): CatalogPaymentCheckResult {
  return {
    status: "succeeded",
    operation_id: operationId,
    payment: {
      id: payment.id,
      currency_code: payment.currency_code,
      captures: (payment.captures ?? []).map((capture) => ({
        id: capture.id,
        amount: capture.amount,
      })),
    },
  }
}

// Отказ на этом шаге означает, что покупатель мог заплатить, а заказ не
// создан. По прежним логам такой случай был неотличим от безобидного
// сетевого сбоя: ядро печатало «getPaymentStatus: undefined undefined».
// Пишем событие, по которому инцидент находится одним запросом в Loki и
// содержит всё нужное для разбора: корзину, платёжную сессию, код и ответ.
export function formatPaymentStatusErrorLog(input: {
  cart_id?: string | null
  payment_session_id?: string | null
  error: unknown
}): string {
  const { message, code } = describeProviderError(input.error)
  const response = (input.error as { providerResponse?: unknown })?.providerResponse

  const serializedResponse = (() => {
    if (response === undefined) {
      return "не возвращён"
    }

    try {
      return JSON.stringify(response)
    } catch {
      return "нечитаемый ответ"
    }
  })()

  return (
    `[catalog] level=ERROR event=payment_status_error ` +
    `cart_id=${input.cart_id || "неизвестна"} ` +
    `payment_session_id=${input.payment_session_id || "неизвестна"} ` +
    `code=${code} message="${message}" provider_response=${serializedResponse}`
  )
}

export const checkCatalogPaymentStatusStep = createStep(
  "check-catalog-payment-status",
  async (
    input: {
      payment_session_id: string
      cart_id?: string
      external_event_key?: string
    },
    { container }
  ) => {
    const paymentService = container.resolve(
      Modules.PAYMENT
    ) as PaymentModuleWithProviderService
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const operations = container.resolve<PaymentOperationModuleService>(
      PAYMENT_OPERATION_MODULE
    )

    const withErrorLogging = async <T>(operation: () => Promise<T>): Promise<T> => {
      try {
        return await operation()
      } catch (error) {
        logger.error(
          formatPaymentStatusErrorLog({
            cart_id: input.cart_id,
            payment_session_id: input.payment_session_id,
            error,
          })
        )
        throw error
      }
    }

    let session = await withErrorLogging(() =>
      paymentService.retrievePaymentSession(input.payment_session_id, {
        relations: ["payment", "payment.captures"],
      })
    )
    const linkedOperationId =
      typeof session.data?.payment_operation_id === "string"
        ? session.data.payment_operation_id
        : null
    const operation = linkedOperationId
      ? await operations.retrievePaymentOperation(linkedOperationId)
      : (
          await operations.claimPaymentOperation({
            type: "payment",
            provider_id: session.provider_id,
            cart_id:
              input.cart_id ??
              (typeof session.data?.cart_id === "string" ? session.data.cart_id : null),
            amount: String(session.amount),
            currency_code: session.currency_code,
            provider_operation_id:
              typeof session.data?.id === "string" ? session.data.id : null,
            idempotency_key: `payment:${session.id}`,
            action: "status_check",
          })
        ).operation

    if (operation.state === "completed") {
      session = await paymentService.retrievePaymentSession(session.id, {
        relations: ["payment", "payment.captures"],
      })
      if (!session.payment) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Выполненная платёжная операция не связана с платежом"
        )
      }
      const persisted = await paymentService.retrievePayment(session.payment.id, {
        relations: ["captures"],
      })
      return new StepResponse(paymentResult(persisted, operation.id))
    }

    if (operation.state === "declined_final") {
      return new StepResponse<CatalogPaymentCheckResult>({
        status: "failed",
        operation_id: operation.id,
        payment: null,
      })
    }

    let checked: Awaited<ReturnType<PaymentProviderStatusService["getStatus"]>>
    try {
      checked = await withErrorLogging(() =>
        paymentService.paymentProviderService_.getStatus(session.provider_id, {
          data: session.data,
        })
      )
    } catch (error) {
      const description = describeProviderError(error)
      await operations.transitionPaymentOperation({
        operation_id: operation.id,
        to_state: "result_unknown",
        source: "reconciliation",
        action: "status_check",
        result: "error",
        external_event_key: input.external_event_key,
        error_category: description.code,
        error_reason: description.message,
      })
      throw error
    }

    assertProviderPaymentMatchesSession(checked.data, session)

    await paymentService.updatePaymentSession({
      id: session.id,
      amount: session.amount,
      currency_code: session.currency_code,
      data: checked.data,
      status: checked.status,
    })

    if (checked.status === PaymentSessionStatus.CANCELED) {
      await operations.transitionPaymentOperation({
        operation_id: operation.id,
        to_state: "declined_final",
        source: "reconciliation",
        action: "status_check",
        result: "canceled",
        provider_operation_id:
          typeof checked.data.id === "string" ? checked.data.id : null,
        external_event_key: input.external_event_key,
      })
      return new StepResponse<CatalogPaymentCheckResult>({
        status: "failed",
        operation_id: operation.id,
        payment: null,
      })
    }

    if (checked.status !== PaymentSessionStatus.CAPTURED) {
      await operations.transitionPaymentOperation({
        operation_id: operation.id,
        to_state: "processing",
        source: "reconciliation",
        action: "status_check",
        result: "pending",
        provider_operation_id:
          typeof checked.data.id === "string" ? checked.data.id : null,
        external_event_key: input.external_event_key,
      })
      return new StepResponse<CatalogPaymentCheckResult>({
        status: "pending",
        operation_id: operation.id,
        payment: null,
      })
    }

    session = await paymentService.retrievePaymentSession(session.id, {
      relations: ["payment", "payment.captures"],
    })
    let payment: PaymentDTO | null | undefined = session.payment

    if (!payment) {
      payment = await paymentService.authorizePaymentSession(session.id, {})
    } else if (!payment.captured_at) {
      await paymentService.capturePayment({
        payment_id: payment.id,
        amount: session.amount,
        is_captured: true,
      })
    }

    if (!payment) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Подтверждённый платёж не был сохранён"
      )
    }

    const persistedPayment = await paymentService.retrievePayment(payment.id, {
      relations: ["captures"],
    })

    if (!persistedPayment.captured_at || !persistedPayment.captures?.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Подтверждённый платёж не отмечен как оплаченный"
      )
    }

    await operations.transitionPaymentOperation({
      operation_id: operation.id,
      to_state: "completed",
      source: "reconciliation",
      action: "status_check",
      result: "captured",
      provider_operation_id:
        typeof checked.data.id === "string" ? checked.data.id : null,
      external_event_key: input.external_event_key,
    })

    return new StepResponse(paymentResult(persistedPayment, operation.id))
  }
)
