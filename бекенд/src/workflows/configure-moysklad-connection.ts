import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  configureMoyskladConnectionStep,
  type ConfigureMoyskladConnectionInput,
} from "./steps/moysklad-connection"

export const configureMoyskladConnectionWorkflow = createWorkflow(
  "configure-moysklad-connection",
  function (input: ConfigureMoyskladConnectionInput) {
    const config = configureMoyskladConnectionStep(input)

    return new WorkflowResponse(config)
  }
)
