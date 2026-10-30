import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  createShippingReturnRequestStep,
  deleteShippingReturnRequestStep,
  type CreateShippingReturnRequestInput,
  type UpdateShippingReturnRequestInput,
  updateShippingReturnRequestStep,
} from "./steps/shipping-provider-registry"

export const createShippingReturnRequestWorkflow = createWorkflow(
  "create-shipping-return-request",
  function (input: CreateShippingReturnRequestInput) {
    return new WorkflowResponse(createShippingReturnRequestStep(input))
  }
)

export const updateShippingReturnRequestWorkflow = createWorkflow(
  "update-shipping-return-request",
  function (input: UpdateShippingReturnRequestInput) {
    return new WorkflowResponse(updateShippingReturnRequestStep(input))
  }
)

export const deleteShippingReturnRequestWorkflow = createWorkflow(
  "delete-shipping-return-request",
  function (id: string) {
    return new WorkflowResponse(deleteShippingReturnRequestStep(id))
  }
)
