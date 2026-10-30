import { PaymentSessionStatus } from "@medusajs/framework/utils"

import {
  CATALOG_PAYMENT_EXPIRED_AT,
  CATALOG_PAYMENT_EXPIRED_MESSAGE,
} from "../../workflows/steps/expire-catalog-payment-cart"

// Покупатель не должен менять корзину после того, как отправил заказ и ушёл
// платить: состав уже передан платёжной системе, остатки зарезервированы.
// 13 сентября 2026 такая правка на лету приводила к HTTP 500 — оба запроса
// дрались за лок на одну корзину.
//
// Признак считает сервер, а не браузер: иначе второй вкладкой, другим
// устройством или прямым обращением к API блокировку было бы видно только
// на словах.

export type CartFreezeReason = "payment_pending" | "completed" | "expired"

export type FrozenCartState = {
  frozen: boolean
  reason: CartFreezeReason | null
}

type SessionLike = {
  status?: unknown
  created_at?: unknown
}

type CartLike = {
  completed_at?: unknown
  metadata?: Record<string, unknown> | null
  payment_collection?: {
    // Элементы допускают null: query.graph отдаёт payment_sessions как
    // Maybe<PaymentSession>[], и объявление без null не сходилось с ним по
    // типам — medusa build падал на TS2345 у обоих вызывающих.
    payment_sessions?: (SessionLike | null | undefined)[] | null
  } | null
}

// Сколько платёжная сессия считается живой. У Medusa нет собственного срока
// годности сессии, а бессрочной заморозки быть не должно: покупатель, который
// закрыл окно оплаты и не вернулся, обязан снова получить свою корзину.
export const PAYMENT_SESSION_TTL_MS = 30 * 60 * 1000

// pending заморозку СОХРАНЯЕТ: это ровно тот момент, когда оплата идёт и
// трогать корзину опаснее всего.
// Разморозить корзину могут только отказ и отмена — ERROR и CANCELED сюда
// не входят намеренно.
const FREEZING_STATUSES = new Set<string>([
  PaymentSessionStatus.PENDING,
  PaymentSessionStatus.AUTHORIZED,
  PaymentSessionStatus.CAPTURED,
  PaymentSessionStatus.REQUIRES_MORE,
  PaymentSessionStatus.PENDING_AUTHORIZATION,
])

function sessionIsFreezing(session: SessionLike, now: number): boolean {
  if (!FREEZING_STATUSES.has(String(session.status))) {
    return false
  }

  const createdAt = session.created_at ? new Date(String(session.created_at)).getTime() : NaN

  if (Number.isNaN(createdAt)) {
    // Без даты считаем сессию живой: ошибиться в сторону заморозки безопаснее,
    // чем разрешить правку корзины во время оплаты.
    return true
  }

  return now - createdAt < PAYMENT_SESSION_TTL_MS
}

export function getCartFreezeState(
  cart: CartLike | null | undefined,
  now: number = Date.now()
): FrozenCartState {
  if (!cart) {
    return { frozen: false, reason: null }
  }

  if (cart.completed_at) {
    return { frozen: true, reason: "completed" }
  }

  if (typeof cart.metadata?.[CATALOG_PAYMENT_EXPIRED_AT] === "string") {
    return { frozen: true, reason: "expired" }
  }

  const sessions = cart.payment_collection?.payment_sessions ?? []
  const hasLiveSession = sessions.some(
    (session) => !!session && sessionIsFreezing(session, now)
  )

  return hasLiveSession
    ? { frozen: true, reason: "payment_pending" }
    : { frozen: false, reason: null }
}

export const CART_FROZEN_ERROR_CODE = "cart_frozen"

export const CART_FROZEN_MESSAGES: Record<CartFreezeReason, string> = {
  payment_pending:
    "Заказ оформляется, идёт оплата. Изменить корзину сейчас нельзя — дождитесь результата оплаты.",
  completed: "Заказ по этой корзине уже оформлен.",
  expired: CATALOG_PAYMENT_EXPIRED_MESSAGE,
}
