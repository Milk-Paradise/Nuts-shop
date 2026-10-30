import type { IPaymentModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules, PaymentActions } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type VerifyCatalogRefundWebhookInput = {
  provider: string
  refund_id: string
  body: Record<string, unknown>
  raw_data_base64: string
  headers: Record<string, unknown>
}

export type VerifiedCatalogRefundWebhook = {
  refund_id: string
  payment_id: string
  amount: string
  currency_code: string
  payment_session_id: string
  payment_data: Record<string, unknown>
}

export const verifyCatalogRefundWebhookStep = createStep(
  "verify-catalog-refund-webhook",
  async (input: VerifyCatalogRefundWebhookInput, { container }) => {
    const paymentService = container.resolve(
      Modules.PAYMENT
    ) as IPaymentModuleService
    const result = await paymentService.getWebhookActionAndData({
      provider: input.provider,
      payload: {
        data: input.body,
        rawData: Buffer.from(input.raw_data_base64, "base64"),
        headers: input.headers,
      },
    })

    const data = result.data as Record<string, unknown> | undefined
    if (
      result.action !== PaymentActions.SUCCESSFUL ||
      data?.refund_id !== input.refund_id ||
      typeof data.payment_id !== "string" ||
      typeof data.amount !== "string" ||
      typeof data.currency_code !== "string" ||
      typeof data.payment_session_id !== "string" ||
      !data.payment_data ||
      typeof data.payment_data !== "object" ||
      Array.isArray(data.payment_data)
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "YooKassa refund webhook could not be verified"
      )
    }

    return new StepResponse({
      refund_id: data.refund_id,
      payment_id: data.payment_id,
      amount: data.amount,
      currency_code: data.currency_code.toLowerCase(),
      payment_session_id: data.payment_session_id,
      payment_data: data.payment_data as Record<string, unknown>,
    } satisfies VerifiedCatalogRefundWebhook)
  }
)
