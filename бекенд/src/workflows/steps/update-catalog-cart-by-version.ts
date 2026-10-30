import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { CART_VERSIONING_MODULE } from "../../modules/cart"
import type CartVersioningService from "../../modules/cart/service"

export type UpdateCatalogCartByVersionInput = {
  cart_id: string
  expected_version: number
  data: Record<string, unknown>
}

type UpdateCatalogCartByVersionCompensation = {
  cart_id: string
  expected_version: number
  data: Record<string, unknown>
}

export const updateCatalogCartByVersionStep = createStep(
  "update-catalog-cart-by-version",
  async (input: UpdateCatalogCartByVersionInput, { container, context }) => {
    const service = container.resolve<CartVersioningService>(
      CART_VERSIONING_MODULE
    )
    const current = await service.updateCartByVersion(
      input.cart_id,
      input.expected_version,
      input.data,
      context
    )

    return new StepResponse(current, {
      cart_id: input.cart_id,
      expected_version: current.version,
      data: {
        completed_at: null,
      },
    } satisfies UpdateCatalogCartByVersionCompensation)
  },
  async (compensation, { container, context }) => {
    if (!compensation) {
      return
    }

    const service = container.resolve<CartVersioningService>(
      CART_VERSIONING_MODULE
    )
    await service.updateCartByVersion(
      compensation.cart_id,
      compensation.expected_version,
      compensation.data,
      context
    )
  }
)
