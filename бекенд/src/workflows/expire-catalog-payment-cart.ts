import {
  acquireLockStep,
  releaseLockStep,
} from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  expireCatalogPaymentCartStep,
  type ExpireCatalogPaymentCartInput,
} from "./steps/expire-catalog-payment-cart"

const THIRTY_SECONDS = 30
const TWO_MINUTES = 2 * 60

export const expireCatalogPaymentCartWorkflow = createWorkflow(
  "expire-catalog-payment-cart",
  function (input: ExpireCatalogPaymentCartInput) {
    const lockKey = transform(
      { input },
      ({ input }) => input.cart_id
    )

    acquireLockStep({
      key: lockKey,
      timeout: THIRTY_SECONDS,
      ttl: TWO_MINUTES,
    })

    const result = expireCatalogPaymentCartStep(input)
    const releaseKey = transform({ lockKey, result }, ({ lockKey }) => lockKey)
    releaseLockStep({ key: releaseKey })

    return new WorkflowResponse(result)
  }
)
