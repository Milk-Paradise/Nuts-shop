import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import type { ConfigureNotificationChannelInput } from "../modules/notification-domain/channel-settings"
import { configureNotificationChannelStep } from "./steps/notification-channel-settings"

export const configureNotificationChannelWorkflow = createWorkflow(
  "configure-notification-channel",
  function (input: ConfigureNotificationChannelInput) {
    return new WorkflowResponse(configureNotificationChannelStep(input))
  }
)
