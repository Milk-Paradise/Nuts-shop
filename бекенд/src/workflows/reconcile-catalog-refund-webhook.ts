import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { reconcileCatalogRefundWebhookStep } from "./steps/reconcile-catalog-refund-webhook"
import {
  verifyCatalogRefundWebhookStep,
  type VerifyCatalogRefundWebhookInput,
} from "./steps/verify-catalog-refund-webhook"

export type ReconcileCatalogRefundWebhookInput = Omit<
  VerifyCatalogRefundWebhookInput,
  "refund_id"
> & { refund_id: string }

const NINETY_DAYS = 90 * 24 * 60 * 60

export const reconcileCatalogRefundWebhookWorkflow = createWorkflow(
  {
    name: "reconcile-catalog-refund-webhook",
    store: true,
    idempotent: true,
    retentionTime: NINETY_DAYS,
  },
  function (input: ReconcileCatalogRefundWebhookInput) {
    const verified = verifyCatalogRefundWebhookStep(input)
    const reconciled = reconcileCatalogRefundWebhookStep(verified)
    return new WorkflowResponse(reconciled)
  }
)
