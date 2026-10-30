import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { createMoyskladIncomingPaymentStep } from "./steps/create-moysklad-incoming-payment"

export const createMoyskladIncomingPaymentWorkflow = createWorkflow(
  "create-moysklad-incoming-payment",
  function (input: { orderId: string; amount: number; currencyCode: string; paidAt: Date }) {
    const result = createMoyskladIncomingPaymentStep(input)
    return new WorkflowResponse(result)
  }
)
