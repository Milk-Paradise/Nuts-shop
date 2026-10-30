import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  type SaveSellerEmailInput,
  disconnectSellerTelegramStep,
  issueSellerTelegramBindingStep,
  saveSellerEmailStep,
} from "./steps/seller-notification-channels"

export const saveSellerEmailWorkflow = createWorkflow(
  "save-seller-email",
  function (input: SaveSellerEmailInput) {
    return new WorkflowResponse(saveSellerEmailStep(input))
  }
)

export const issueSellerTelegramBindingWorkflow = createWorkflow(
  "issue-seller-telegram-binding",
  function () {
    return new WorkflowResponse(issueSellerTelegramBindingStep())
  }
)

export const disconnectSellerTelegramWorkflow = createWorkflow(
  "disconnect-seller-telegram",
  function () {
    return new WorkflowResponse(disconnectSellerTelegramStep())
  }
)
