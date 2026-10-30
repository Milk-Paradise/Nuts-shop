import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  upsertSiteTabStep,
  type UpsertSiteTabStepInput,
} from "./steps/upsert-site-tab"

const upsertSiteTabWorkflow = createWorkflow(
  "upsert-site-tab",
  function (input: UpsertSiteTabStepInput) {
    const tab = upsertSiteTabStep(input)

    return new WorkflowResponse(tab)
  }
)

export default upsertSiteTabWorkflow
