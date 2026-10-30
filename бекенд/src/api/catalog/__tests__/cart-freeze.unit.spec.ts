import {
  getCartFreezeState,
  PAYMENT_SESSION_TTL_MS,
} from "../cart-freeze"

const NOW = new Date("2026-09-13T10:00:00Z").getTime()

function cartWithSession(status: string, createdAtMs = NOW - 60_000) {
  return {
    completed_at: null,
    payment_collection: {
      payment_sessions: [
        { id: "payses_1", status, created_at: new Date(createdAtMs).toISOString() },
      ],
    },
  }
}

describe("признак заморозки корзины", () => {
  it("корзина без оплаты доступна для правки", () => {
    expect(getCartFreezeState({ completed_at: null }, NOW)).toEqual({
      frozen: false,
      reason: null,
    })
  })

  it("pending сохраняет заморозку — оплата идёт прямо сейчас", () => {
    expect(getCartFreezeState(cartWithSession("pending"), NOW)).toEqual({
      frozen: true,
      reason: "payment_pending",
    })
  })

  it.each(["authorized", "captured", "requires_more", "pending_authorization"])(
    "статус %s тоже держит корзину замороженной",
    (status) => {
      expect(getCartFreezeState(cartWithSession(status), NOW).frozen).toBe(true)
    }
  )

  it.each(["error", "canceled"])("статус %s снимает заморозку", (status) => {
    expect(getCartFreezeState(cartWithSession(status), NOW)).toEqual({
      frozen: false,
      reason: null,
    })
  })

  it("завершённая корзина заморожена навсегда", () => {
    expect(
      getCartFreezeState({ completed_at: "2026-09-13T09:00:00Z" }, NOW)
    ).toEqual({ frozen: true, reason: "completed" })
  })

  it("истёкшая гостевая корзина требует собрать новую", () => {
    expect(
      getCartFreezeState({
        completed_at: null,
        metadata: { catalog_payment_expired_at: "2026-09-12T10:00:00Z" },
      }, NOW)
    ).toEqual({ frozen: true, reason: "expired" })
  })

  it("истёкшая платёжная сессия не держит корзину бессрочно", () => {
    // Покупатель закрыл окно оплаты и не вернулся: корзина обязана
    // разморозиться сама, иначе он потеряет её навсегда.
    const stale = cartWithSession("pending", NOW - PAYMENT_SESSION_TTL_MS - 1000)

    expect(getCartFreezeState(stale, NOW)).toEqual({ frozen: false, reason: null })
  })

  it("сессия без даты считается живой — ошибаемся в безопасную сторону", () => {
    const cart = {
      completed_at: null,
      payment_collection: {
        payment_sessions: [{ id: "payses_1", status: "pending" }],
      },
    }

    expect(getCartFreezeState(cart, NOW).frozen).toBe(true)
  })

  it("отсутствие корзины не считается заморозкой", () => {
    expect(getCartFreezeState(null, NOW)).toEqual({ frozen: false, reason: null })
    expect(getCartFreezeState(undefined, NOW)).toEqual({ frozen: false, reason: null })
  })

  // query.graph отдаёт Maybe<PaymentSession>[]: дыры в списке возможны и
  // раньше роняли бы перебор, а не просто не замораживали корзину.
  it("пустые элементы в списке сессий не мешают увидеть живую", () => {
    const cart = {
      completed_at: null,
      payment_collection: {
        payment_sessions: [
          null,
          { id: "s1", status: "pending", created_at: new Date(NOW - 1000).toISOString() },
        ],
      },
    }

    expect(getCartFreezeState(cart, NOW)).toEqual({
      frozen: true,
      reason: "payment_pending",
    })
  })

  it("список из одних пустых элементов не замораживает корзину", () => {
    const cart = {
      completed_at: null,
      payment_collection: { payment_sessions: [null, undefined] },
    }

    expect(getCartFreezeState(cart, NOW)).toEqual({ frozen: false, reason: null })
  })

  it("одна живая сессия замораживает корзину даже рядом с отменёнными", () => {
    const cart = {
      completed_at: null,
      payment_collection: {
        payment_sessions: [
          { id: "s1", status: "canceled", created_at: new Date(NOW - 5000).toISOString() },
          { id: "s2", status: "pending", created_at: new Date(NOW - 1000).toISOString() },
        ],
      },
    }

    expect(getCartFreezeState(cart, NOW)).toEqual({
      frozen: true,
      reason: "payment_pending",
    })
  })
})
