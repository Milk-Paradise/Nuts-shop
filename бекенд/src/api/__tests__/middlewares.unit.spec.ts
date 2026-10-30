import { ContainerRegistrationKeys, PolicyOperation } from "@medusajs/framework/utils"

import { CART_RATE_LIMIT_RESPONSE, cartRateLimit } from "../cart-rate-limit"
import middlewareConfig from "../middlewares"
import { maskAdminNotificationResponse } from "../admin/notifications/mask-response"

function rateLimitFixture() {
  const values = new Map<string, unknown>()
  const expiry = new Map<string, number>()
  const cache = {
    get: jest.fn(async (key: string) => {
      if ((expiry.get(key) ?? Infinity) <= Date.now()) {
        values.delete(key)
        expiry.delete(key)
      }
      return values.get(key) ?? null
    }),
    set: jest.fn(async (key: string, value: unknown, ttl: number) => {
      values.set(key, value)
      expiry.set(key, Date.now() + ttl * 1000)
      return ttl
    }),
  }
  let tail = Promise.resolve()
  const locking = {
    execute: jest.fn(async (_key: string, job: () => Promise<unknown>) => {
      const previous = tail
      let release: () => void
      tail = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
      try {
        return await job()
      } finally {
        release!()
      }
    }),
  }
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  }
  const scope = {
    resolve: jest.fn((name: string) => {
      if (name === "cache") return cache
      if (name === "locking") return locking
      if (name === ContainerRegistrationKeys.LOGGER) return logger
      throw new Error(`Unexpected dependency: ${name}`)
    }),
  }

  function request(overrides: Record<string, unknown> = {}) {
    return {
      auth_context: undefined,
      ip: "203.0.113.10",
      scope,
      ...overrides,
    } as any
  }

  async function invoke(req = request()) {
    const res = {
      header: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const next = jest.fn()
    await cartRateLimit(req, res as any, next)
    return { res, next }
  }

  return { cache, invoke, locking, logger, request, values }
}

describe("API middleware registration", () => {
  const routes = (middlewareConfig as any).routes as any[]

  it("registers security and validation middleware on sensitive boundaries", () => {
    expect(routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ matcher: "/admin/payment-providers/:provider_id" }),
      expect.objectContaining({ matcher: "/admin/shipping-providers/cdek" }),
      expect.objectContaining({ matcher: "/store/catalog/checkout" }),
      expect.objectContaining({ matcher: "/store/account/orders/:id/cancel" }),
    ]))
  })

  it("keeps the notification journal separate from Medusa notifications", () => {
    expect(routes).toContainEqual(expect.objectContaining({
      matcher: "/admin/notification-journal",
    }))
    const maskedRoutes = routes.filter((route) =>
      route.middlewares?.includes(maskAdminNotificationResponse)
    )
    expect(maskedRoutes).toEqual([
      { matcher: "/admin/notifications", methods: ["GET"], middlewares: [maskAdminNotificationResponse] },
      { matcher: "/admin/notifications/:id", methods: ["GET"], middlewares: [maskAdminNotificationResponse] },
    ])
  })

  it("keeps catalog validators and checkout guards on the store namespace", () => {
    const matchers = [
      "/store/catalog/search",
      "/store/catalog/categories/:handle/products",
      "/store/catalog/shipping/options",
      "/store/catalog/shipping/tariffs",
      "/store/catalog/shipping/points",
      "/store/catalog/shipping/address",
      "/store/catalog/shipping/select",
      "/store/catalog/cart/validate",
      "/store/catalog/payment/initiate",
      "/store/catalog/payment/status",
      "/store/catalog/checkout",
    ]

    for (const matcher of matchers) {
      expect(routes).toContainEqual(expect.objectContaining({ matcher }))
    }

    expect(routes.filter((route) => route.matcher === "/store/catalog/checkout"))
      .toHaveLength(2)
    expect(routes.find((route) => route.matcher === "/store/catalog/payment/initiate"))
      .toEqual(expect.objectContaining({ middlewares: expect.any(Array) }))
  })

  it("registers the cart rate limit before cart-specific handlers and excludes OPTIONS", () => {
    const route = routes.find((candidate) => candidate.matcher === "/store/carts*")

    expect(route).toEqual(expect.objectContaining({
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
      middlewares: [cartRateLimit],
    }))
    expect(routes.indexOf(route)).toBeLessThan(
      routes.findIndex((candidate) => candidate.matcher === "/store/carts/:id/merge-into-customer")
    )
  })

  it("does not count OPTIONS requests even if the middleware is invoked", async () => {
    const fixture = rateLimitFixture()
    const { next } = await fixture.invoke(fixture.request({ method: "OPTIONS" }))

    expect(next).toHaveBeenCalledTimes(1)
    expect(fixture.cache.get).not.toHaveBeenCalled()
    expect(fixture.cache.set).not.toHaveBeenCalled()
    expect(fixture.locking.execute).not.toHaveBeenCalled()
    expect(fixture.logger.info).not.toHaveBeenCalled()
    expect(fixture.logger.warn).not.toHaveBeenCalled()
    expect(fixture.values.size).toBe(0)
  })

  it("logs allowed cart requests with a normalized path and pseudonymous customer", async () => {
    const fixture = rateLimitFixture()
    const customerId = "cus_secret"
    const sessionId = "session_secret"
    const address = "203.0.113.42"

    await fixture.invoke(fixture.request({
      auth_context: { actor_id: customerId },
      cookies: { "connect.sid": sessionId },
      ip: address,
      method: "GET",
      originalUrl: "/store/carts/cart_01ABC/line-items/li_1?fields=id",
    }))

    expect(fixture.logger.info).toHaveBeenCalledWith(expect.stringMatching(
      /^\[backend\] level=INFO event=cart_request service=backend method=GET path="\/store\/carts\/:id\/line-items\/:id" customer="customer:[a-f0-9]{24}" decision=allowed window_seconds=60$/
    ))
    const message = fixture.logger.info.mock.calls[0][0]
    expect(message).not.toContain(customerId)
    expect(message).not.toContain(sessionId)
    expect(message).not.toContain(address)
  })

  it("normalizes entity identifiers in nested cart paths", async () => {
    const fixture = rateLimitFixture()

    await fixture.invoke(fixture.request({
      method: "POST",
      originalUrl: "/store/carts/cart_01ABC/promotions/promo_01ABC",
    }))

    expect(fixture.logger.info).toHaveBeenCalledWith(expect.stringContaining(
      'path="/store/carts/:id/promotions/:id"'
    ))
  })

  it("logs limited cart requests and ignores logger failures", async () => {
    const fixture = rateLimitFixture()
    fixture.logger.info.mockImplementation(() => {
      throw new Error("logger unavailable")
    })
    fixture.logger.warn.mockImplementation(() => {
      throw new Error("logger unavailable")
    })

    const allowed = await fixture.invoke()
    expect(allowed.next).toHaveBeenCalledTimes(1)

    for (let count = 0; count < 59; count += 1) await fixture.invoke()
    const { res, next } = await fixture.invoke()

    expect(fixture.logger.warn).toHaveBeenCalledWith(expect.stringContaining(
      "level=WARN event=cart_request service=backend"
    ))
    expect(fixture.logger.warn).toHaveBeenCalledWith(expect.stringContaining(
      "decision=limited window_seconds=60"
    ))
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(429)
  })

  it("allows sixty cart requests and rejects the sixty-first with retry details", async () => {
    const fixture = rateLimitFixture()

    for (let count = 0; count < 60; count += 1) {
      const { next } = await fixture.invoke()
      expect(next).toHaveBeenCalledTimes(1)
    }
    const { res, next } = await fixture.invoke()

    expect(next).not.toHaveBeenCalled()
    expect(res.header).toHaveBeenCalledWith("Retry-After", "60")
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.json).toHaveBeenCalledWith(CART_RATE_LIMIT_RESPONSE)
    expect(fixture.cache.set).toHaveBeenLastCalledWith(
      expect.stringMatching(/^cart-rate-limit:address:[a-f0-9]{24}$/),
      expect.objectContaining({ timestamps: expect.any(Array) }),
      61
    )
  })

  it("serializes concurrent requests so no more than sixty pass", async () => {
    const fixture = rateLimitFixture()
    const responses = await Promise.all(
      Array.from({ length: 61 }, () => fixture.invoke(fixture.request({ auth_context: { actor_id: "cus_1" } })))
    )

    expect(responses.filter(({ next }) => next.mock.calls.length === 1)).toHaveLength(60)
    expect(responses.filter(({ res }) => res.status.mock.calls[0]?.[0] === 429)).toHaveLength(1)
  })

  it("opens a new window after a minute and expires state after sixty-one seconds", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    try {
      const fixture = rateLimitFixture()

      for (let count = 0; count < 60; count += 1) await fixture.invoke()
      jest.advanceTimersByTime(60_000)
      expect((await fixture.invoke()).next).toHaveBeenCalled()

      const key = fixture.cache.set.mock.calls[0][0]
      jest.advanceTimersByTime(61_000)
      await fixture.cache.get(key)
      expect(fixture.values.has(key)).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  it("uses separate hashed keys for customers, sessions, and client addresses", async () => {
    const fixture = rateLimitFixture()

    await fixture.invoke(fixture.request({ auth_context: { actor_id: "cus_1" } }))
    await fixture.invoke(fixture.request({ cookies: { "connect.sid": "opaque-session" } }))
    await fixture.invoke(fixture.request({ ip: "203.0.113.11" }))

    const keys = fixture.cache.set.mock.calls.map(([key]) => key)
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
    expect(keys.join(" ")).not.toContain("cus_1")
    expect(keys.join(" ")).not.toContain("opaque-session")
    expect(keys.join(" ")).not.toContain("203.0.113.11")
  })

  it("fails closed when cache access fails", async () => {
    const fixture = rateLimitFixture()
    fixture.cache.get.mockRejectedValueOnce(new Error("cache unavailable"))

    const { res, next } = await fixture.invoke()
    expect(next).not.toHaveBeenCalled()
    expect(res.header).toHaveBeenCalledWith("Retry-After", "1")
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.json).toHaveBeenCalledWith(CART_RATE_LIMIT_RESPONSE)
    expect(fixture.logger.warn).toHaveBeenCalledWith(expect.stringContaining(
      "decision=limited window_seconds=60"
    ))
  })
})
