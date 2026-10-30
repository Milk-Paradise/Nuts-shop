import type {
  ICartModuleService,
  IInventoryService,
  IPaymentModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { paymentProviderRegistry } from "../../modules/payment-provider-config/registry"

export const CATALOG_PAYMENT_EXPIRATION_HOURS = 1
export const CATALOG_PAYMENT_EXPIRED_AT = "catalog_payment_expired_at"
export const CATALOG_PAYMENT_EXPIRED_MESSAGE =
  "Срок хранения гостевой корзины истёк. Соберите корзину заново."

type PaymentSessionForExpiration = {
  id?: string | null
  status?: string | null
  provider_id?: string | null
  created_at?: string | Date | null
  updated_at?: string | Date | null
}

type CartForPaymentExpiration = {
  id: string
  customer_id?: string | null
  completed_at?: string | Date | null
  metadata?: Record<string, unknown> | null
  items?: Array<{ id: string }> | null
  payment_collection?: {
    payment_sessions?: PaymentSessionForExpiration[] | null
  } | null
}

// A session in either of these states has money behind it and belongs to the
// finalisation path, not to expiry: releasing its stock would leave a paid
// customer with nothing reserved.
const settledSessionStatuses = new Set<string>([
  PaymentSessionStatus.AUTHORIZED,
  PaymentSessionStatus.CAPTURED,
])

export type ExpireCatalogPaymentCartInput = {
  cart_id: string
  now: string
}

async function retrieveCart(container: MedusaContainer, cartId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "customer_id",
      "completed_at",
      "metadata",
      "items.id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.created_at",
      "payment_collection.payment_sessions.updated_at",
    ],
    filters: { id: cartId },
  })

  return data[0] as CartForPaymentExpiration | undefined
}

function latestOnlinePaymentActivity(sessions: PaymentSessionForExpiration[]) {
  return sessions.reduce((latest, session) => {
    const timestamp = new Date(
      session.updated_at ?? session.created_at ?? 0
    ).getTime()

    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest
  }, 0)
}

function onlinePaymentSessions(cart: CartForPaymentExpiration) {
  const providerIds = new Set(
    paymentProviderRegistry.map((provider) => provider.medusa_id)
  )

  return (cart.payment_collection?.payment_sessions ?? []).filter(
    (session) => session.provider_id && providerIds.has(session.provider_id)
  )
}

/**
 * Releases what the abandoned cart still holds: the payment session at the
 * provider first, the reserved stock second.
 *
 * The order is the point. While a pending session lives the customer can still
 * pay at the provider, so freeing the stock first opens a window where a late
 * capture produces a paid order with nothing reserved behind it.
 */
async function releaseCartHold(
  container: MedusaContainer,
  cart: CartForPaymentExpiration,
  sessions: PaymentSessionForExpiration[]
) {
  const paymentService = container.resolve(
    Modules.PAYMENT
  ) as IPaymentModuleService

  for (const session of sessions) {
    if (session.id) {
      await paymentService.deletePaymentSession(session.id)
    }
  }

  const lineItemIds = (cart.items ?? []).map((item) => item.id).filter(Boolean)

  if (lineItemIds.length) {
    const inventoryService = container.resolve(
      Modules.INVENTORY
    ) as IInventoryService
    await inventoryService.deleteReservationItemsByLineItem(lineItemIds)
  }
}

export async function expireCatalogPaymentCart(
  container: MedusaContainer,
  input: ExpireCatalogPaymentCartInput
) {
  const cart = await retrieveCart(container, input.cart_id)

  if (
    !cart ||
    cart.customer_id ||
    cart.completed_at ||
    typeof cart.metadata?.[CATALOG_PAYMENT_EXPIRED_AT] === "string"
  ) {
    return { expired: false }
  }

  const now = new Date(input.now)
  const cutoff =
    now.getTime() - CATALOG_PAYMENT_EXPIRATION_HOURS * 60 * 60 * 1000
  const sessions = onlinePaymentSessions(cart)
  const lastActivity = latestOnlinePaymentActivity(sessions)

  if (
    !Number.isFinite(now.getTime()) ||
    !lastActivity ||
    lastActivity > cutoff
  ) {
    return { expired: false }
  }

  if (sessions.some((session) => settledSessionStatuses.has(session.status ?? ""))) {
    return { expired: false }
  }

  // The hold is released before the cart is marked, so a failure anywhere in
  // here leaves the cart unmarked and the next run tries it again — rather than
  // recording it as handled while the stock is still held.
  await releaseCartHold(container, cart, sessions)

  const cartService = container.resolve(Modules.CART) as ICartModuleService
  await cartService.updateCarts(cart.id, {
    metadata: {
      ...(cart.metadata ?? {}),
      [CATALOG_PAYMENT_EXPIRED_AT]: now.toISOString(),
    },
  })

  return { expired: true }
}

export const expireCatalogPaymentCartStep = createStep(
  "expire-catalog-payment-cart",
  async (input: ExpireCatalogPaymentCartInput, { container }) => {
    return new StepResponse(await expireCatalogPaymentCart(container, input))
  }
)
