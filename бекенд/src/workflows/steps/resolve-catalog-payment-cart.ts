import type {
  IPaymentModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type ResolveCatalogPaymentCartInput = {
  cart_id?: string
  payment_session_id?: string
}

export async function resolveCatalogPaymentCart(
  container: MedusaContainer,
  input: ResolveCatalogPaymentCartInput
) {
  if (input.cart_id) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    // Existing storefronts send the saved order ID in cart_id after checkout.
    // Resolve it to the original cart before entering the common payment flow.
    if (input.cart_id.startsWith("order_")) {
      const { data } = await query.graph({
        entity: "order_cart",
        fields: ["cart_id"],
        filters: { order_id: input.cart_id },
      })
      const cartId = data[0]?.cart_id
      if (typeof cartId !== "string" || !cartId) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, "Корзина заказа не найдена")
      }
      return { cart_id: cartId }
    }
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id"],
      filters: { id: input.cart_id },
    })

    if (!data[0]?.id) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Корзина не найдена")
    }

    return { cart_id: data[0].id as string }
  }

  if (!input.payment_session_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Не указана корзина или платёжная сессия"
    )
  }

  const paymentService = container.resolve(
    Modules.PAYMENT
  ) as IPaymentModuleService
  const session = await paymentService.retrievePaymentSession(
    input.payment_session_id
  )
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart_payment_collection",
    fields: ["cart_id"],
    filters: { payment_collection_id: session.payment_collection_id },
  })
  const cartId = data[0]?.cart_id

  if (typeof cartId !== "string" || !cartId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Платёжная сессия не связана с корзиной"
    )
  }

  return { cart_id: cartId }
}

export const resolveCatalogPaymentCartStep = createStep(
  "resolve-catalog-payment-cart",
  async (input: ResolveCatalogPaymentCartInput, { container }) => {
    return new StepResponse(await resolveCatalogPaymentCart(container, input))
  }
)
