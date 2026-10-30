import yookassaProviderModule from "@gorgo/medusa-payment-yookassa/providers/payment-yookassa"
import { MedusaError, PaymentActions } from "@medusajs/framework/utils"
import { createHash } from "node:crypto"

import { describeProviderError, normalizeProviderError } from "./errors"
import { PAYMENT_PROVIDER_CONFIG_MODULE } from "../../modules/payment-provider-config"
import PaymentProviderConfigModuleService from "../../modules/payment-provider-config/service"
import { PAYMENT_OPERATION_MODULE } from "../../modules/payment-operation"
import type PaymentOperationModuleService from "../../modules/payment-operation/service"

type RuntimeContainer = {
  [PAYMENT_PROVIDER_CONFIG_MODULE]: PaymentProviderConfigModuleService
  [PAYMENT_OPERATION_MODULE]: PaymentOperationModuleService
}

const INITIATE_PAYMENT_TIMEOUT_MS = 30_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "ЮKassa не ответила за 30 секунд"
        )
      )
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

type YooCheckoutClient = {
  constructor: new (options: { shopId: string; secretKey: string }) => unknown
  getPayment(id: string): Promise<{
    id?: string
    status?: string
    amount?: { value?: string; currency?: string }
    refunded_amount?: { value?: string; currency?: string }
    metadata?: Record<string, unknown> & { session_id?: string }
  }>
  getRefund(id: string): Promise<{
    id?: string
    payment_id?: string
    status?: string
    amount?: { value?: string; currency?: string }
  }>
}

type YooKassaWebhookInput = {
  data?: {
    event?: unknown
    object?: { id?: unknown }
  }
}

type YooKassaRefundInput = {
  amount?: unknown
  data?: {
    id?: unknown
    refunded_amount?: { value?: unknown } | unknown
  }
  context?: { idempotency_key?: string }
}

type YooKassaPaymentInput = {
  amount?: unknown
  currency_code?: unknown
  data?: {
    payment_operation_id?: unknown
  }
  context?: { idempotency_key?: string }
}

function refundedAmountValue(data: YooKassaRefundInput["data"]) {
  const refundedAmount = data?.refunded_amount

  if (refundedAmount && typeof refundedAmount === "object") {
    return String((refundedAmount as { value?: unknown }).value ?? "0")
  }

  return String(refundedAmount ?? "0")
}

function refundAmountValue(value: unknown) {
  if (value && typeof value === "object") {
    if ("numeric" in value) {
      return String((value as { numeric?: unknown }).numeric ?? "0")
    }

    if ("value" in value) {
      return String((value as { value?: unknown }).value ?? "0")
    }
  }

  return String(value ?? "unknown-amount")
}

function numericAmount(value: unknown) {
  const parsed = Number(refundAmountValue(value))

  return Number.isFinite(parsed) ? parsed : 0
}

function remoteRefundCoversAttempt(
  input: YooKassaRefundInput,
  remotePayment: { refunded_amount?: { value?: string } }
) {
  const localRefunded = numericAmount(refundedAmountValue(input.data))
  const remoteRefunded = numericAmount(remotePayment.refunded_amount?.value)
  const requested = numericAmount(input.amount)

  return requested > 0 && remoteRefunded - localRefunded >= requested
}

function refundCoverageDescription(
  input: YooKassaRefundInput,
  remotePayment: { refunded_amount?: { value?: string } }
) {
  return `ожидалось ${numericAmount(input.amount)}, подтверждено ${numericAmount(
    remotePayment.refunded_amount?.value
  )}, ранее ${numericAmount(refundedAmountValue(input.data))}`
}

export function catalogRefundIdempotencyKey(input: YooKassaRefundInput) {
  const idempotencyKey = input.context?.idempotency_key

  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Medusa refund id is required to create a YooKassa refund"
    )
  }

  return idempotencyKey
}

export function catalogPaymentIdempotencyKey(input: YooKassaPaymentInput) {
  const paymentOperationId = input.data?.payment_operation_id

  if (typeof paymentOperationId !== "string" || !paymentOperationId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "payment_operation_id is required to create a YooKassa payment"
    )
  }

  const fingerprint = JSON.stringify([
    paymentOperationId,
    numericAmount(input.amount).toFixed(2),
    String(input.currency_code ?? "unknown-currency").toUpperCase(),
  ])
  const digest = createHash("sha256").update(fingerprint).digest("hex")

  return `catalog-payment-${digest.slice(0, 48)}`
}

type PackageProviderService = new (
  container: Record<string, unknown>,
  options: Record<string, unknown>
) => {
  yooCheckout_: YooCheckoutClient
  initiatePayment(input: unknown): Promise<unknown>
  getPaymentStatus(input: unknown): Promise<unknown>
  capturePayment(input: unknown): Promise<unknown>
  authorizePayment(input: unknown): Promise<unknown>
  cancelPayment(input: unknown): Promise<unknown>
  retrievePayment(input: unknown): Promise<unknown>
  refundPayment(input: unknown): Promise<unknown>
  deletePayment(input: unknown): Promise<unknown>
  updatePayment(input: unknown): Promise<unknown>
  getWebhookActionAndData(input: unknown): Promise<unknown>
  isWebhookEventValid(input: unknown): Promise<unknown>
}

const [PackageYooKassaService] = yookassaProviderModule.services as PackageProviderService[]

class RuntimeYooKassaService extends PackageYooKassaService {
  static identifier = "yookassa"

  protected readonly paymentProviderConfigService_: PaymentProviderConfigModuleService
  protected readonly paymentOperationService_: PaymentOperationModuleService

  static validateOptions() {}

  constructor(container: RuntimeContainer, options: Record<string, unknown>) {
    super(container, {
      ...options,
      shopId: "runtime-configured",
      secretKey: "runtime-configured",
    })
    this.paymentProviderConfigService_ =
      container[PAYMENT_PROVIDER_CONFIG_MODULE]
    this.paymentOperationService_ = container[PAYMENT_OPERATION_MODULE]
  }

  private async applyRuntimeConfiguration(requireEnabled: boolean) {
    const config =
      await this.paymentProviderConfigService_.retrieveRuntimePaymentProviderConfig(
        "yookassa"
      )

    if (!config) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "YooKassa is not configured"
      )
    }

    if (requireEnabled && !config.is_enabled) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "YooKassa is disabled for new payments"
      )
    }

    const Client = this.yooCheckout_.constructor
    this.yooCheckout_ = new Client({
      shopId: config.shop_id,
      secretKey: config.secret_key,
    }) as YooCheckoutClient
  }

  private async withRuntimeConfiguration(
    requireEnabled: boolean,
    operation: () => Promise<unknown>
  ) {
    await this.applyRuntimeConfiguration(requireEnabled)

    try {
      return await operation()
    } catch (error) {
      // Платёжная система бросает не Error, а объект ответа. Без этого
      // ядро печатало в лог три undefined и разбирать инцидент было не по чему.
      throw normalizeProviderError(error)
    }
  }

  async initiatePayment(input: unknown) {
    const paymentInput = input as YooKassaPaymentInput

    return this.withRuntimeConfiguration(true, async () => {
      try {
        return await withTimeout(
          super.initiatePayment({
            ...paymentInput,
            context: {
              ...paymentInput.context,
              idempotency_key: catalogPaymentIdempotencyKey(paymentInput),
            },
          }),
          INITIATE_PAYMENT_TIMEOUT_MS
        )
      } catch (error) {
        const operationId = paymentInput.data?.payment_operation_id

        if (typeof operationId === "string" && operationId) {
          const description = describeProviderError(error)
          await this.paymentOperationService_.transitionPaymentOperation({
            operation_id: operationId,
            to_state: "result_unknown",
            source: "provider",
            action: "initiate",
            result: "error",
            error_category: description.code,
            error_reason: description.message,
          })
        }

        throw error
      }
    })
  }

  async getPaymentStatus(input: unknown) {
    return this.withRuntimeConfiguration(false, () =>
      super.getPaymentStatus(input)
    )
  }

  async capturePayment(input: unknown) {
    return this.withRuntimeConfiguration(false, () =>
      super.capturePayment(input)
    )
  }

  async authorizePayment(input: unknown) {
    return this.withRuntimeConfiguration(false, () =>
      super.authorizePayment(input)
    )
  }

  async cancelPayment(input: unknown) {
    return this.withRuntimeConfiguration(false, () =>
      super.cancelPayment(input)
    )
  }

  async retrievePayment(input: unknown) {
    return this.withRuntimeConfiguration(false, () =>
      super.retrievePayment(input)
    )
  }

  async refundPayment(input: unknown) {
    const refundInput = input as YooKassaRefundInput

    return this.withRuntimeConfiguration(false, async () => {
      const result = (await super.refundPayment({
        ...refundInput,
        context: {
          ...refundInput.context,
          idempotency_key: catalogRefundIdempotencyKey(refundInput),
        },
      })) as { data?: { refunded_amount?: { value?: string } } }

      if (!result.data || !remoteRefundCoversAttempt(refundInput, result.data)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `YooKassa не подтвердила завершение возврата: ${refundCoverageDescription(
            refundInput,
            result.data ?? {}
          )}`
        )
      }

      return result
    })
  }

  async deletePayment(input: unknown) {
    return this.withRuntimeConfiguration(false, () =>
      super.deletePayment(input)
    )
  }

  async updatePayment(input: unknown) {
    return this.withRuntimeConfiguration(false, () =>
      super.updatePayment(input)
    )
  }

  async getWebhookActionAndData(input: YooKassaWebhookInput) {
    return this.withRuntimeConfiguration(false, async () => {
      const event = input.data?.event
      const objectId = input.data?.object?.id

      if (typeof event !== "string" || typeof objectId !== "string") {
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      if (event === "refund.succeeded") {
        // A webhook is only a trigger. Verify the refund and its parent payment
        // through the authenticated YooKassa API before returning any data.
        const refund = await this.yooCheckout_.getRefund(objectId)
        if (
          refund.id !== objectId ||
          refund.status !== "succeeded" ||
          typeof refund.payment_id !== "string" ||
          !refund.payment_id ||
          typeof refund.amount?.value !== "string" ||
          !/^\d+(?:\.\d+)?$/.test(refund.amount.value) ||
          Number(refund.amount.value) <= 0 ||
          typeof refund.amount.currency !== "string" ||
          !refund.amount.currency
        ) {
          return { action: PaymentActions.NOT_SUPPORTED }
        }

        const payment = await this.yooCheckout_.getPayment(refund.payment_id)
        const sessionId = payment.metadata?.session_id
        if (
          payment.id !== refund.payment_id ||
          payment.status !== "succeeded" ||
          typeof sessionId !== "string" ||
          !sessionId ||
          typeof payment.amount?.value !== "string" ||
          typeof payment.amount.currency !== "string" ||
          payment.amount.currency.toLowerCase() !==
            refund.amount.currency.toLowerCase()
        ) {
          return { action: PaymentActions.NOT_SUPPORTED }
        }

        return {
          action: PaymentActions.SUCCESSFUL,
          data: {
            refund_id: refund.id,
            payment_id: payment.id,
            amount: refund.amount.value,
            currency_code: refund.amount.currency.toLowerCase(),
            payment_session_id: sessionId,
            session_id: sessionId,
            payment_data: payment,
          },
        }
      }

      if (!event.startsWith("payment.")) {
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      // The notification is only a trigger. All data used downstream comes
      // from a fresh authenticated YooKassa API response.
      const payment = await this.yooCheckout_.getPayment(objectId)
      const sessionId = payment.metadata?.session_id
      const amount = payment.amount?.value
      const actionByStatus: Record<string, PaymentActions> = {
        pending: PaymentActions.PENDING,
        waiting_for_capture: PaymentActions.AUTHORIZED,
        succeeded: PaymentActions.SUCCESSFUL,
        canceled: PaymentActions.CANCELED,
      }
      const action = payment.status ? actionByStatus[payment.status] : undefined

      if (
        payment.id !== objectId ||
        !action ||
        typeof sessionId !== "string" ||
        !sessionId ||
        typeof amount !== "string" ||
        !amount
      ) {
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      return {
        action,
        data: {
          session_id: sessionId,
          amount,
        },
      }
    })
  }

  async isWebhookEventValid(input: unknown) {
    return this.withRuntimeConfiguration(false, () =>
      super.isWebhookEventValid(input)
    )
  }
}

export default RuntimeYooKassaService
