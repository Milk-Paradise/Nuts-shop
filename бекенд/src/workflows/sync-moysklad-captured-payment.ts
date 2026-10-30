import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { syncMoyskladCapturedPaymentStep } from "./steps/sync-moysklad-captured-payment"

export const syncMoyskladCapturedPaymentWorkflow = createWorkflow("sync-moysklad-captured-payment", function (input: { paymentId: string }) {
  const result = syncMoyskladCapturedPaymentStep(input)
  return new WorkflowResponse(result)
})
