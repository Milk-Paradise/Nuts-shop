import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import type { PreviewTestInput } from "../modules/notification-domain/preview-test-service"
import { previewTestNotificationStep } from "./steps/preview-test-notification"

export const previewTestNotificationWorkflow = createWorkflow(
  "preview-test-notification",
  function (input: PreviewTestInput) {
    return new WorkflowResponse(previewTestNotificationStep(input))
  }
)
