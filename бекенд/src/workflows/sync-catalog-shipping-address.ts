import { updateCartWorkflow } from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { prepareSyncCatalogShippingAddressStep } from "./steps/prepare-sync-catalog-shipping-address"

export type SyncCatalogShippingAddressWorkflowInput = {
  cart_id: string
  city: string
  // Optional: a pickup-point (ПВЗ) quote only syncs the city — courier syncs
  // all four.
  street?: string
  house?: string
  apartment?: string
}

export const syncCatalogShippingAddressWorkflow = createWorkflow(
  "sync-catalog-shipping-address",
  function (input: SyncCatalogShippingAddressWorkflowInput) {
    const cartUpdateInput = prepareSyncCatalogShippingAddressStep(input)

    updateCartWorkflow.runAsStep({ input: cartUpdateInput })

    return new WorkflowResponse(
      transform({ input }, ({ input }) => ({ cart_id: input.cart_id }))
    )
  }
)

export { buildCatalogShippingAddressFields } from "./steps/prepare-sync-catalog-shipping-address"
