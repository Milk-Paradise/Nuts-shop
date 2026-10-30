import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  setMoyskladConnectionActivityStep,
  type SetMoyskladConnectionActivityInput,
} from "./steps/moysklad-connection"

export const setMoyskladConnectionActivityWorkflow = createWorkflow(
  "set-moysklad-connection-activity",
  function (input: SetMoyskladConnectionActivityInput) {
    const config = setMoyskladConnectionActivityStep(input)

    return new WorkflowResponse(config)
  }
)
