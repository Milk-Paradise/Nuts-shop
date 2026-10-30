import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { createMoyskladCustomerOrderStep } from "./steps/create-moysklad-customer-order"

export const createMoyskladCustomerOrderWorkflow = createWorkflow(
  "create-moysklad-customer-order",
  function (input: { orderId: string }) {
    const result = createMoyskladCustomerOrderStep(input)

    return new WorkflowResponse(result)
  }
)
