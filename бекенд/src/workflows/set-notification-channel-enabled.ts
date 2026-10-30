import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  type SetNotificationChannelEnabledInput,
  setNotificationChannelEnabledStep,
} from "./steps/notification-channel-settings"

export const setNotificationChannelEnabledWorkflow = createWorkflow(
  "set-notification-channel-enabled",
  function (input: SetNotificationChannelEnabledInput) {
    return new WorkflowResponse(setNotificationChannelEnabledStep(input))
  }
)
