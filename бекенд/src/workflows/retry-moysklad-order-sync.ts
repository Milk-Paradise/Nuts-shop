import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  retryMoyskladOrderSyncStep,
  type MoyskladRetryTarget,
} from "./steps/retry-moysklad-order-sync"

export const retryMoyskladOrderSyncWorkflow = createWorkflow(
  "retry-moysklad-order-sync",
  function (input: { orderId: string; target?: MoyskladRetryTarget }) {
    const orderSync = retryMoyskladOrderSyncStep(input)

    return new WorkflowResponse(orderSync)
  }
)
