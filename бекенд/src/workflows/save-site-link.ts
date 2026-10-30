import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  saveSiteLinkStep,
  type SaveSiteLinkStepInput,
} from "./steps/save-site-link"

const saveSiteLinkWorkflow = createWorkflow(
  "save-site-link",
  function (input: SaveSiteLinkStepInput) {
    const link = saveSiteLinkStep(input)

    return new WorkflowResponse(link)
  }
)

export default saveSiteLinkWorkflow
