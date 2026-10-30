import { createPaymentSessionsWorkflow } from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import type { InitiateCatalogPaymentBody } from "../api/catalog/validators"
import {
  prepareCatalogOnlinePaymentOutputStep,
  type CatalogPaymentSessionOutput,
} from "./steps/catalog-online-payment-runtime"
import { prepareCatalogOnlinePaymentStep } from "./steps/prepare-catalog-online-payment"

export type InitiateCatalogOnlinePaymentOutput =
  | { status: "already_paid" | "pending_reconciliation" }
  | ({ status: "active" | "created" } & CatalogPaymentSessionOutput)

export type InitiateCatalogOnlinePaymentInput = InitiateCatalogPaymentBody & {
  customer_id?: string | null
}

export const initiateCatalogOnlinePaymentWorkflow = createWorkflow(
  "initiate-catalog-online-payment",
  function (input: InitiateCatalogOnlinePaymentInput) {
    const preparation = prepareCatalogOnlinePaymentStep({
      order_id: input.order_id,
      provider_id: input.provider_id,
      customer_id: input.customer_id,
    })
    const initiatedPayment = when(
      "initiate-catalog-online-payment-session",
      { preparation },
      ({ preparation }) => preparation.status === "created"
    ).then(() => {
      const paymentSession = createPaymentSessionsWorkflow.runAsStep({
        input: transform({ input, preparation }, ({ input, preparation }) => ({
          payment_collection_id: preparation.payment_collection_id,
          provider_id: preparation.medusa_provider_id,
          customer_id: input.customer_id ?? undefined,
          data: {
            cart_id: preparation.cart_id,
            payment_operation_id: preparation.payment_operation_id as string,
            e2e_fail_initiation: preparation.e2e_fail_initiation,
            // The YooKassa provider receives checkout contacts from `data.cart`.
            // At this point the cart is completed, so the immutable order is the
            // only source of those fields.
            cart: {
              id: preparation.cart_id,
              email: preparation.contacts.email,
              shipping_address: preparation.contacts.shipping_address,
            },
            confirmation: {
              type: "redirect",
              return_url: input.return_url,
            },
            description: `Оплата заказа ${preparation.order_id}`,
          },
        })),
      })

      return prepareCatalogOnlinePaymentOutputStep({
        payment_collection_id: preparation.payment_collection_id,
        payment_session: paymentSession,
      })
    })
    const output = transform(
      { preparation, initiatedPayment },
      ({ preparation, initiatedPayment }) =>
        preparation.status === "already_paid" || preparation.status === "pending_reconciliation"
          ? { status: preparation.status }
          : {
              status: preparation.status,
              ...(preparation.existing_payment ?? initiatedPayment),
            }
    )

    return new WorkflowResponse(output)
  }
)
