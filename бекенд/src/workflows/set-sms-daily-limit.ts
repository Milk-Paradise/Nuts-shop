import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  type SetSmsDailyLimitInput,
  setSmsDailyLimitStep,
} from "./steps/notification-channel-settings"

export const setSmsDailyLimitWorkflow = createWorkflow(
  "set-sms-daily-limit",
  function (input: SetSmsDailyLimitInput) {
    return new WorkflowResponse(setSmsDailyLimitStep(input))
  }
)
