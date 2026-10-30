import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  CART_FROZEN_ERROR_CODE,
  CART_FROZEN_MESSAGES,
  getCartFreezeState,
} from "./cart-freeze"

const CART_FIELDS = [
  "id",
  "completed_at",
  "metadata",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.status",
  "payment_collection.payment_sessions.created_at",
]

// Блокировка в интерфейсе — это удобство, а не защита: второй вкладкой или
// прямым обращением к API её обойти ничего не стоит. Правило живёт на сервере,
// поэтому действует одинаково для любого клиента.
export function rejectFrozenCart(cartIdFrom: (req: MedusaRequest) => string | undefined) {
  return async function rejectFrozenCartMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) {
    const cartId = cartIdFrom(req)

    if (!cartId) {
      return next()
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "cart",
      fields: CART_FIELDS,
      filters: { id: cartId },
    })

    const state = getCartFreezeState(data?.[0])

    if (!state.frozen || !state.reason) {
      return next()
    }

    res.status(409).json({
      code: CART_FROZEN_ERROR_CODE,
      type: "conflict",
      reason: state.reason,
      message: CART_FROZEN_MESSAGES[state.reason],
    })
  }
}

export const cartIdFromParams = (req: MedusaRequest) =>
  (req.params as { id?: string })?.id

export const cartIdFromBody = (req: MedusaRequest) =>
  (req.body as { cart_id?: string })?.cart_id
