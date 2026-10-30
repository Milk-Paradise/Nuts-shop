import { randomUUID } from "node:crypto"

import type {
  AuthorizePaymentInput,
  CancelPaymentInput,
  CapturePaymentInput,
  DeletePaymentInput,
  GetPaymentStatusInput,
  InitiatePaymentInput,
  RefundPaymentInput,
  RetrievePaymentInput,
  UpdatePaymentInput,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

type Options = { base_url?: string }
type PaymentData = Record<string, unknown> & {
  id: string
  amount: { value: string; currency: string }
}

function paymentData(input: { data?: Record<string, unknown> }): PaymentData {
  const data = input.data
  if (
    !data ||
    typeof data.id !== "string" ||
    !data.amount ||
    typeof data.amount !== "object"
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "E2E payment data is incomplete"
    )
  }
  return data as PaymentData
}

export default class E2EPaymentProviderService extends AbstractPaymentProvider<Options> {
  static identifier = "e2e"

  constructor(container: Record<string, unknown>, options: Options) {
    super(container, options)
  }

  static validateOptions(options: Options) {
    if (!options.base_url) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "E2E payment stub URL is required"
      )
    }
  }

  private async stub(path: string, init?: RequestInit) {
    const response = await fetch(`${this.config.base_url}${path}`, {
      ...init,
      signal: AbortSignal.timeout(5_000),
    })
    const body = (await response.json()) as Record<string, unknown>
    if (!response.ok) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        typeof body.message === "string"
          ? body.message
          : "E2E payment stub request failed"
      )
    }
    return body
  }

  async initiatePayment(input: InitiatePaymentInput) {
    if (input.data?.e2e_fail_initiation === true) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Не удалось начать оплату. Корзина сохранена — попробуйте ещё раз."
      )
    }

    const id = `e2e_pay_${randomUUID().replaceAll("-", "")}`
    const returnUrl = (input.data?.confirmation as { return_url?: unknown } | undefined)
      ?.return_url
    const created = await this.stub("/payments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        return_url: returnUrl,
      }),
    })
    const amount = input.amount as unknown as {
      numeric?: unknown
      value?: unknown
    }
    const data: PaymentData = {
      ...input.data,
      id,
      amount: {
        value: String(amount.numeric ?? amount.value ?? input.amount),
        currency: input.currency_code,
      },
      confirmation: { confirmation_url: created.confirmation_url },
    }

    return { id, status: PaymentSessionStatus.PENDING, data }
  }

  async getPaymentStatus(input: GetPaymentStatusInput) {
    const data = paymentData(input)
    const remote = await this.stub(`/payments/${encodeURIComponent(data.id)}`)
    const status = remote.status === "captured"
      ? PaymentSessionStatus.CAPTURED
      : remote.status === "canceled"
        ? PaymentSessionStatus.CANCELED
        : PaymentSessionStatus.PENDING
    return { status, data }
  }

  async authorizePayment(input: AuthorizePaymentInput) {
    const checked = await this.getPaymentStatus(input)
    return { status: checked.status, data: checked.data }
  }

  async capturePayment(input: CapturePaymentInput) {
    return { data: paymentData(input) }
  }

  async cancelPayment(input: CancelPaymentInput) {
    return { data: paymentData(input) }
  }

  async deletePayment(input: DeletePaymentInput) {
    return { data: input.data }
  }

  async refundPayment(input: RefundPaymentInput) {
    return { data: paymentData(input) }
  }

  async retrievePayment(input: RetrievePaymentInput) {
    return { data: paymentData(input) }
  }

  async updatePayment(input: UpdatePaymentInput) {
    return { status: (await this.getPaymentStatus(input)).status, data: paymentData(input) }
  }

  async getWebhookActionAndData() {
    return { action: PaymentActions.NOT_SUPPORTED }
  }
}
