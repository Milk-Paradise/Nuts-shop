import { emitEventStep } from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { verifyCatalogPaymentWebhookStep } from "./steps/verify-catalog-payment-webhook"

export const CATALOG_PAYMENT_STATUS_CHECK_REQUESTED =
  "catalog.payment_status_check_requested"

export type VerifyCatalogPaymentWebhookInput = {
  provider: string
  provider_id: string
  provider_payment_id: string
  event: string
  body: Record<string, unknown>
  raw_data_base64: string
  headers: Record<string, unknown>
}

const NINETY_DAYS = 90 * 24 * 60 * 60

export const verifyCatalogPaymentWebhookWorkflow = createWorkflow(
  {
    name: "verify-catalog-payment-webhook",
    store: true,
    idempotent: true,
    retentionTime: NINETY_DAYS,
  },
  function (input: VerifyCatalogPaymentWebhookInput) {
    const verified = verifyCatalogPaymentWebhookStep({
      provider: input.provider,
      body: input.body,
      raw_data_base64: input.raw_data_base64,
      headers: input.headers,
    })
    const statusCheck = transform(
      { input, verified },
      ({ input, verified }) => ({
        provider_id: input.provider_id,
        provider_payment_id: input.provider_payment_id,
        session_id: verified.session_id,
        event: input.event,
      })
    )

    emitEventStep({
      eventName: CATALOG_PAYMENT_STATUS_CHECK_REQUESTED,
      data: statusCheck,
    })

    return new WorkflowResponse(statusCheck)
  }
)
