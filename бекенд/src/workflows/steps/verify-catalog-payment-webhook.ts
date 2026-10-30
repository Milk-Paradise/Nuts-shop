import type { IPaymentModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules, PaymentActions } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type VerifyCatalogPaymentWebhookInput = {
  provider: string
  body: Record<string, unknown>
  raw_data_base64: string
  headers: Record<string, unknown>
}

export const verifyCatalogPaymentWebhookStep = createStep(
  "verify-catalog-payment-webhook",
  async (input: VerifyCatalogPaymentWebhookInput, { container }) => {
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

    if (
      result.action === PaymentActions.NOT_SUPPORTED ||
      !result.data?.session_id
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "YooKassa webhook could not be verified"
      )
    }

    return new StepResponse({
      action: result.action,
      amount: result.data.amount,
      session_id: result.data.session_id,
    })
  }
)
