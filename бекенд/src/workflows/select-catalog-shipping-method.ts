import {
  acquireLockStep,
  addShippingMethodToCartWorkflow,
  releaseLockStep,
  removeShippingMethodFromCartStep,
} from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { resolveCatalogPickupPointStep } from "./steps/resolve-catalog-pickup-point"
import {
  prepareCatalogShippingSelectionStep,
  retrieveCatalogShippingMethodIdsStep,
} from "./steps/prepare-catalog-shipping-selection"

export type SelectCatalogShippingMethodWorkflowInput = {
  cart_id: string
  option_id: string
  point_id?: string
}

export const selectCatalogShippingMethodWorkflow = createWorkflow(
  "select-catalog-shipping-method",
  function (input: SelectCatalogShippingMethodWorkflowInput) {
    const pickupPoint = resolveCatalogPickupPointStep({
      cart_id: input.cart_id,
      point_id: input.point_id,
    })
    const selection = prepareCatalogShippingSelectionStep({
      cart_id: input.cart_id,
      option_id: input.option_id,
      point_id: input.point_id,
      pickup_point: pickupPoint,
    })
    const existingMethods = retrieveCatalogShippingMethodIdsStep({
      cart_id: input.cart_id,
    })

    acquireLockStep({ key: input.cart_id, timeout: 10, ttl: 30 })

    const removedMethods = when(
      "remove-existing-catalog-shipping-methods",
      { existingMethods },
      ({ existingMethods }) => existingMethods.ids.length > 0
    ).then(() =>
      removeShippingMethodFromCartStep(
        transform({ existingMethods }, ({ existingMethods }) => ({
          shipping_method_ids: existingMethods.ids,
        }))
      )
    )

    const addShippingMethodInput = transform(
      { input, selection, removedMethods },
      ({ input, selection }) => ({
        cart_id: input.cart_id,
        options: selection.options,
      })
    )

    const addedMethods = addShippingMethodToCartWorkflow.runAsStep({
      input: addShippingMethodInput,
    })

    releaseLockStep({
      key: transform({ input, addedMethods }, ({ input }) => input.cart_id),
    })

    return new WorkflowResponse(
      transform({ selection }, ({ selection }) => ({
        shipping_option_id: selection.selected_id,
      }))
    )
  }
)
