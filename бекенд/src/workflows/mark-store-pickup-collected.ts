import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { markStorePickupCollectedStep } from "./steps/mark-store-pickup-collected"

export const markStorePickupCollectedWorkflow = createWorkflow(
  "mark-store-pickup-collected",
  function (input: { order_id: string }) {
    acquireLockStep({ key: input.order_id, timeout: 10, ttl: 30 })
    const collected = markStorePickupCollectedStep(input)
    releaseLockStep({
      key: transform({ input, collected }, ({ input }) => input.order_id),
    })

    return new WorkflowResponse(collected)
  }
)

