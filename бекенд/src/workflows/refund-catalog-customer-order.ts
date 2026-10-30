import {
  acquireLockStep,
  releaseLockStep,
} from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { executeCatalogOrderRefundStep } from "./steps/execute-catalog-order-refund"
import { prepareCatalogOrderRefundStep } from "./steps/prepare-catalog-order-refund"

export type RefundCatalogCustomerOrderInput = {
  order_id: string
  requested_by?: string
  requested_amount?: number
  refund_request_id?: string
}

const THIRTY_SECONDS = 30
const TWO_MINUTES = 2 * 60
const NINETY_DAYS = 90 * 24 * 60 * 60

export const refundCatalogCustomerOrderWorkflow = createWorkflow(
  {
    name: "refund-catalog-customer-order",
    store: true,
    idempotent: false,
    retentionTime: NINETY_DAYS,
  },
  function (input: RefundCatalogCustomerOrderInput) {
    acquireLockStep({
      key: input.order_id,
      timeout: THIRTY_SECONDS,
      ttl: TWO_MINUTES,
    })

    const preparation = prepareCatalogOrderRefundStep(input)
    const refunded = executeCatalogOrderRefundStep(preparation)

    releaseLockStep({
      key: transform(
        { input, preparation, refunded },
        ({ input }) => input.order_id
      ),
    })

    return new WorkflowResponse(
      transform({ preparation, refunded }, ({ preparation }) => ({
        order_id: preparation.order_id,
      }))
    )
  }
)
