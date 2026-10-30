import { createWorkflow, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { setShippingProviderVisibilityStep } from "./steps/set-shipping-provider-visibility"
import { ensureCdekShippingOptionsStep } from "./steps/ensure-cdek-shipping-options"
import { CDEK_PROVIDER_KEY } from "../modules/shipping-provider-registry"

type SetShippingProviderVisibilityInput = {
  provider_key: string
  is_visible: boolean
}

const setShippingProviderVisibilityWorkflow = createWorkflow(
  "set-shipping-provider-visibility",
  function (input: SetShippingProviderVisibilityInput) {
    const record = setShippingProviderVisibilityStep(input)
    when(input, (value) => value.provider_key === CDEK_PROVIDER_KEY)
      .then(() => ensureCdekShippingOptionsStep({ enabled: input.is_visible }))

    return new WorkflowResponse(record)
  }
)

export default setShippingProviderVisibilityWorkflow
