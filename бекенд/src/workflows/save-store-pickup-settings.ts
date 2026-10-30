import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  saveStorePickupSettingsStep,
  type SaveStorePickupSettingsInput,
} from "./steps/save-store-pickup-settings"
import { ensureStorePickupShippingOptionsStep } from "./steps/ensure-store-pickup-shipping-options"

export const saveStorePickupSettingsWorkflow = createWorkflow(
  "save-store-pickup-settings",
  function (input: SaveStorePickupSettingsInput) {
    const settings = saveStorePickupSettingsStep(input)
    const availability = transform({ settings }, ({ settings }) => ({
      address: settings.address,
      is_enabled: settings.is_enabled,
    }))
    const options = ensureStorePickupShippingOptionsStep(availability)

    return new WorkflowResponse(
      transform({ settings, options }, ({ settings, options }) => ({
        settings,
        shipping_options: options,
      }))
    )
  }
)
