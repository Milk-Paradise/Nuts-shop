import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { completeMoyskladOrderFulfillmentStep } from "./complete-moysklad-order-fulfillment"

export const completeMoyskladOrderFulfillmentWorkflow = createWorkflow(
  "complete-moysklad-order-fulfillment",
  function (input: { orderId: string }) {
    const result = completeMoyskladOrderFulfillmentStep(input)
    return new WorkflowResponse(result)
  }
)
