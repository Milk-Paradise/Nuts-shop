import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  setPaymentProviderEnabledStep,
  type SetPaymentProviderEnabledStepInput,
} from "./steps/set-payment-provider-enabled"

export const setPaymentProviderEnabledWorkflow = createWorkflow(
  "set-payment-provider-enabled-workflow",
  function (input: SetPaymentProviderEnabledStepInput) {
    return new WorkflowResponse(setPaymentProviderEnabledStep(input))
  }
)
