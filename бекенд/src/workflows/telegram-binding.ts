import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  type DisableTelegramBindingInput,
  type IssueTelegramBindingInput,
  type ProcessTelegramWebhookInput,
  disableTelegramBindingStep,
  issueTelegramBindingStep,
  processTelegramWebhookStep,
} from "./steps/telegram-binding"

export const issueTelegramBindingWorkflow = createWorkflow(
  "issue-telegram-binding",
  function (input: IssueTelegramBindingInput) {
    return new WorkflowResponse(issueTelegramBindingStep(input))
  }
)

export const disableTelegramBindingWorkflow = createWorkflow(
  "disable-telegram-binding",
  function (input: DisableTelegramBindingInput) {
    return new WorkflowResponse(disableTelegramBindingStep(input))
  }
)

export const processTelegramWebhookWorkflow = createWorkflow(
  "process-telegram-webhook",
  function (input: ProcessTelegramWebhookInput) {
    return new WorkflowResponse(processTelegramWebhookStep(input))
  }
)
