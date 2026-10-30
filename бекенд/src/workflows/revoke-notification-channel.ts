import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  type RevokeNotificationChannelInput,
  revokeNotificationChannelStep,
} from "./steps/notification-channel-settings"

export const revokeNotificationChannelWorkflow = createWorkflow(
  "revoke-notification-channel",
  function (input: RevokeNotificationChannelInput) {
    return new WorkflowResponse(revokeNotificationChannelStep(input))
  }
)
