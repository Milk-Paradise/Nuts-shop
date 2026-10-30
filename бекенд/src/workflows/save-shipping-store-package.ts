import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import type { SaveShippingStorePackageInput } from "../modules/shipping-provider-registry/service"
import { saveShippingStorePackageStep } from "./steps/shipping-provider-registry"

export const saveShippingStorePackageWorkflow = createWorkflow(
  "save-shipping-store-package",
  function (input: SaveShippingStorePackageInput) {
    return new WorkflowResponse(saveShippingStorePackageStep(input))
  }
)
