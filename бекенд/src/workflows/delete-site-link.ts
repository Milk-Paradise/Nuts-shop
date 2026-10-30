import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  deleteSiteLinkStep,
  type DeleteSiteLinkStepInput,
} from "./steps/delete-site-link"

const deleteSiteLinkWorkflow = createWorkflow(
  "delete-site-link",
  function (input: DeleteSiteLinkStepInput) {
    const result = deleteSiteLinkStep(input)

    return new WorkflowResponse(result)
  }
)

export default deleteSiteLinkWorkflow
