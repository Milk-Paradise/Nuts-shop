import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  processSmscCallbackStep,
  type ProcessSmscCallbackInput,
} from "./steps/process-smsc-callback"

export const processSmscCallbackWorkflow = createWorkflow(
  "process-smsc-callback",
  function (input: ProcessSmscCallbackInput) {
    return new WorkflowResponse(processSmscCallbackStep(input))
  }
)
