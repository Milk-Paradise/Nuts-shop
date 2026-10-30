import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { CART_VERSIONING_MODULE } from "../../modules/cart"
import type CartVersioningService from "../../modules/cart/service"

export type CheckCartVersionInput = {
  cart_id: string
  expected_version: number
}

export const checkCartVersionStep = createStep(
  "check-cart-version",
  async (input: CheckCartVersionInput, { container }) => {
    // Ни query.graph("cart"), ни Modules.CART.retrieveCart не видят version:
    // поле живёт в отдельном shared-table partial-модуле cartVersioning, и
    // ORM-метаданные core Cart про него не знают (AIL-502 убрал совпадение
    // имён, на котором это раньше случайно держалось). getVersion читает его
    // тем же прямым SQL, которым updateCartByVersion его же пишет.
    const cartService = container.resolve<CartVersioningService>(
      CART_VERSIONING_MODULE
    )
    const version = await cartService.getVersion(input.cart_id)

    if (version === null) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Cart ${input.cart_id} not found`
      )
    }

    if (version !== input.expected_version) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        `Cart version mismatch: expected ${input.expected_version}, got ${version}`
      )
    }

    return new StepResponse(null)
  }
)
