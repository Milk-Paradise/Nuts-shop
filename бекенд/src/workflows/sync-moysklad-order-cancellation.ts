import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { syncMoyskladOrderCancellationStep } from "./steps/sync-moysklad-order-cancellation"

export const syncMoyskladOrderCancellationWorkflow = createWorkflow(
  "sync-moysklad-order-cancellation",
  function (input: { orderId: string }) {
    const result = syncMoyskladOrderCancellationStep(input)
    return new WorkflowResponse(result)
  }
)
