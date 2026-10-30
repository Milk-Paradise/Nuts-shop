import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  previewAndTestNotification,
  type PreviewTestInput,
} from "../../modules/notification-domain/preview-test-service"

export async function previewTestNotification(
  container: Pick<MedusaContainer, "resolve">,
  input: PreviewTestInput
) {
  return previewAndTestNotification(container, input)
}

export const previewTestNotificationStep = createStep(
  "preview-test-notification",
  async (input: PreviewTestInput, { container }) =>
    new StepResponse(await previewTestNotification(container, input))
)
