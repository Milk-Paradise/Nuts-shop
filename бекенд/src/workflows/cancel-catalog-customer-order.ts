import {
  acquireLockStep,
  cancelOrderWorkflow,
  cancelOrdersStep,
  deleteReservationsByLineItemsStep,
  emitEventStep,
  releaseLockStep,
  updatePaymentCollectionStep,
} from "@medusajs/medusa/core-flows"
import {
  EventPriority,
  OrderWorkflowEvents,
  PaymentCollectionStatus,
} from "@medusajs/framework/utils"
import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { prepareCatalogOrderCancellationStep } from "./steps/prepare-catalog-order-cancellation"
import { cancelOrderCdekFulfillmentsStep } from "./steps/cancel-order-delivery-fulfillments"
import { createCatalogShippingReturnRequestStep } from "./steps/create-catalog-shipping-return-request"
import { executeCatalogPaymentCancellationsStep } from "./steps/execute-catalog-payment-cancellations"
import { reflectCatalogPaymentOperationsStep } from "./steps/reflect-catalog-payment-operation"

export const CATALOG_ORDER_REFUND_REQUESTED =
  "catalog.order_refund_requested"
export const CATALOG_SHIPPING_RETURN_REQUESTED =
  "catalog.shipping_return_requested"
export const CATALOG_CUSTOMER_ORDER_CANCELED =
  "catalog.customer_order_canceled"

export type CancelCatalogCustomerOrderInput = {
  order_id: string
  customer_id: string
  customer_email: string
}

const THIRTY_SECONDS = 30
const TWO_MINUTES = 2 * 60
const THREE_DAYS = 3 * 24 * 60 * 60

export const cancelCatalogCustomerOrderWorkflow = createWorkflow(
  {
    name: "cancel-catalog-customer-order",
    store: true,
    idempotent: false,
    retentionTime: THREE_DAYS,
  },
  function (input: CancelCatalogCustomerOrderInput) {
    acquireLockStep({
      key: input.order_id,
      timeout: THIRTY_SECONDS,
      ttl: TWO_MINUTES,
    })

    const preparation = prepareCatalogOrderCancellationStep(input)

    const fulfillmentCancellation = when(
      "cancel-order-delivery-fulfillments",
      { preparation },
      ({ preparation }) =>
        !preparation.already_canceled &&
        !preparation.requires_return_request &&
        preparation.active_cdek_fulfillment_ids.length > 0
    ).then(() =>
      cancelOrderCdekFulfillmentsStep(
        transform({ input, preparation }, ({ input, preparation }) => ({
          order_id: input.order_id,
          fulfillment_ids: preparation.active_cdek_fulfillment_ids,
        }))
      )
    )

    const returnRequest = when(
      "create-catalog-shipping-return-request",
      { preparation },
      ({ preparation }) => preparation.requires_return_request
    ).then(() =>
      createCatalogShippingReturnRequestStep(
        transform({ input, preparation }, ({ input, preparation }) => ({
          order_id: input.order_id,
          reason: "Автоматически создано вместо недоступной отмены",
          previous_delivery_status: preparation.previous_delivery_status!,
        }))
      )
    )

    const returnRequestEvent = when(
      "notify-catalog-shipping-return-requested",
      { returnRequest },
      ({ returnRequest }) => returnRequest?.created === true
    ).then(() =>
      emitEventStep(
        transform({ input, returnRequest }, ({ input, returnRequest }) => ({
          eventName: CATALOG_SHIPPING_RETURN_REQUESTED,
          data: {
            order_id: input.order_id,
            customer_email: input.customer_email,
            return_request_id: returnRequest!.request.id,
            return_reason: returnRequest!.request.reason,
          },
        }))
      ).config({ name: "emit-catalog-shipping-return-requested" })
    )

    const manualCancellation = when(
      "cancel-manual-catalog-order",
      { preparation, fulfillmentCancellation, returnRequest },
      ({ preparation }) =>
        !preparation.already_canceled &&
        !preparation.requires_return_request &&
        !preparation.is_online
    ).then(() =>
      cancelOrderWorkflow.runAsStep({
        input: transform({ input }, ({ input }) => ({
          order_id: input.order_id,
          canceled_by: input.customer_id,
        })),
      })
    )

    const onlineCancellation = when(
      "cancel-online-catalog-order",
      { preparation, fulfillmentCancellation, returnRequest },
      ({ preparation }) =>
        !preparation.already_canceled &&
        !preparation.requires_return_request &&
        preparation.is_online
    ).then(() => {
      const deletedReservations = deleteReservationsByLineItemsStep(
        transform({ preparation }, ({ preparation }) =>
          preparation.line_item_ids
        )
      )
      const canceledPayments = executeCatalogPaymentCancellationsStep(
        transform({ preparation }, ({ preparation }) => ({
          order_id: preparation.order_id,
          payments: preparation.uncaptured_payments,
        }))
      )
      const canceledCollections = updatePaymentCollectionStep(
        transform(
          { preparation, deletedReservations, canceledPayments },
          ({ preparation }) => ({
            selector: { id: preparation.payment_collection_ids },
            update: { status: PaymentCollectionStatus.CANCELED },
          })
        )
      )
      const canceledOrders = cancelOrdersStep(
        transform(
          { input, preparation, canceledCollections },
          ({ input, preparation }) => ({
            orderIds: [preparation.order_id],
            canceled_by: input.customer_id,
          })
        )
      )

      const canceledEvent = emitEventStep(
        transform({ preparation, canceledOrders }, ({ preparation }) => ({
          eventName: OrderWorkflowEvents.CANCELED,
          data: { id: preparation.order_id },
          options: { priority: EventPriority.CRITICAL },
        }))
      ).config({ name: "emit-catalog-online-order-canceled" })

      const reflectedPayments = reflectCatalogPaymentOperationsStep(
        transform(
          { preparation, canceledPayments, canceledOrders, canceledEvent },
          ({ preparation, canceledPayments }) => ({
            operation_ids: canceledPayments.operation_ids,
            order_id: preparation.order_id,
          })
        )
      )

      return transform(
        { canceledOrders, canceledEvent, reflectedPayments },
        ({ canceledOrders }) => canceledOrders
      )
    })

    const refundRequest = when(
      "request-or-recover-online-order-refund",
      { preparation, manualCancellation, onlineCancellation },
      ({ preparation }) =>
        preparation.is_online &&
        preparation.has_outstanding_online_refund
    ).then(() =>
      emitEventStep(
        transform({ input, preparation }, ({ input, preparation }) => ({
          eventName: CATALOG_ORDER_REFUND_REQUESTED,
          data: {
            order_id: preparation.order_id,
            requested_by: input.customer_id,
          },
        }))
      ).config({ name: "emit-catalog-order-refund-requested" })
    )

    const cancellationEvent = when(
      "notify-catalog-customer-order-canceled",
      { preparation, manualCancellation, onlineCancellation },
      ({ preparation }) =>
        !preparation.already_canceled &&
        !preparation.requires_return_request
    ).then(() =>
      emitEventStep(
        transform({ input }, ({ input }) => ({
          eventName: CATALOG_CUSTOMER_ORDER_CANCELED,
          data: {
            order_id: input.order_id,
            customer_email: input.customer_email,
          },
        }))
      ).config({ name: "emit-catalog-customer-order-canceled" })
    )

    releaseLockStep({
      key: transform(
        {
          input,
          preparation,
          fulfillmentCancellation,
          returnRequest,
          returnRequestEvent,
          manualCancellation,
          onlineCancellation,
          refundRequest,
          cancellationEvent,
        },
        ({ input }) => input.order_id
      ),
    })

    return new WorkflowResponse(
      transform({ preparation, returnRequest }, ({ preparation, returnRequest }) => ({
        order_id: preparation.order_id,
        outcome: returnRequest ? "return_requested" as const : "canceled" as const,
        return_request_id: returnRequest?.request.id ?? null,
      }))
    )
  }
)
