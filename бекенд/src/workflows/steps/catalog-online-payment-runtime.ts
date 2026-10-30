import type { ConfirmVariantInventoryWorkflowInputDTO } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type CatalogPaymentSessionOutput = {
  payment_collection_id: string
  payment_session_id: string
  redirect_url: string
}

export type CatalogPaymentReservationCart = {
  sales_channel_id?: string | null
  items?: Array<{
    id?: string | null
    variant_id?: string | null
    quantity: number
    variant?: unknown | null
  }> | null
}

export function buildCatalogPaymentReservationInput(
  cart: CatalogPaymentReservationCart
): ConfirmVariantInventoryWorkflowInputDTO {
  if (!cart.sales_channel_id) {
    throw new Error("Payment cart is missing a sales channel")
  }

  type ReservationVariant =
    ConfirmVariantInventoryWorkflowInputDTO["variants"][number]
  const variants = new Map<string, ReservationVariant>()
  const items = (cart.items ?? []).map((item) => {
    if (!item?.id || !item.variant_id || !item.variant) {
      throw new Error("Payment cart item is missing inventory data")
    }

    variants.set(item.variant_id, item.variant as ReservationVariant)

    return {
      id: item.id,
      variant_id: item.variant_id,
      quantity: item.quantity,
    }
  })

  return {
    sales_channel_id: cart.sales_channel_id,
    variants: Array.from(variants.values()),
    items,
  }
}

export const prepareCatalogPaymentReservationInputStep = createStep(
  "prepare-catalog-payment-reservation-input",
  (input: { cart: CatalogPaymentReservationCart }) =>
    new StepResponse(buildCatalogPaymentReservationInput(input.cart))
)

type CatalogPaymentSession = {
  id: string
  data?: Record<string, unknown> | null
}

export function buildCatalogOnlinePaymentOutput(
  paymentCollectionId: string,
  paymentSession: CatalogPaymentSession
): CatalogPaymentSessionOutput {
  const data = paymentSession.data as {
    confirmation?: { confirmation_url?: unknown }
  }
  const redirectUrl = data.confirmation?.confirmation_url

  if (typeof redirectUrl !== "string" || !redirectUrl) {
    throw new Error("Payment provider did not return a redirect URL")
  }

  return {
    payment_collection_id: paymentCollectionId,
    payment_session_id: paymentSession.id,
    redirect_url: redirectUrl,
  }
}

export const prepareCatalogOnlinePaymentOutputStep = createStep(
  "prepare-catalog-online-payment-output",
  (input: {
    payment_collection_id: string
    payment_session: CatalogPaymentSession
  }) =>
    new StepResponse(
      buildCatalogOnlinePaymentOutput(
        input.payment_collection_id,
        input.payment_session
      )
    )
)
