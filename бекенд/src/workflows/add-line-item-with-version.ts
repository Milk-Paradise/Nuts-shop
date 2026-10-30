import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { addToCartWorkflow } from "@medusajs/core-flows"

import { acquireLockStep, releaseLockStep } from "./steps/lock"
import { checkCartVersionStep } from "./steps/check-cart-version"
import { updateCatalogCartByVersionStep } from "./steps/update-catalog-cart-by-version"

export type AddLineItemWithVersionInput = {
  cart_id: string
  expected_version: number
  variant_id: string
  quantity: number
}

export const addLineItemWithVersionWorkflow = createWorkflow(
  "add-line-item-with-version",
  (input: AddLineItemWithVersionInput) => {
    // Acquire lock for concurrent protection
    const lock = acquireLockStep({
      key: input.cart_id,
      timeout: 30,
      ttl: 120,
    })

    // Check that version matches current cart version
    checkCartVersionStep({
      cart_id: input.cart_id,
      expected_version: input.expected_version,
    })

    // Call standard Medusa workflow to add item (includes stock check)
    const addedItem = addToCartWorkflow.runAsStep({
      input: {
        cart_id: input.cart_id,
        items: [{ variant_id: input.variant_id, quantity: input.quantity }],
      },
    })

    // Increment version and create audit entry in same transaction
    const updated = updateCatalogCartByVersionStep({
      cart_id: input.cart_id,
      expected_version: input.expected_version,
      data: {},
    })

    // Release lock
    releaseLockStep({ key: input.cart_id })

    return new WorkflowResponse({
      cart: updated.cart,
      version: updated.version,
    })
  }
)
