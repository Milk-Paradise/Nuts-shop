import {
  DELIVERY_WINDOW_MS,
  nextRetryAt,
  retryDelayMs,
  shouldRetryUnknown,
} from "../delivery-policy"

describe("notification delivery policy", () => {
  it("uses exponential delays starting at five seconds", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([
      5_000, 10_000, 20_000, 40_000,
    ])
  })

  it("never schedules a retry outside the 24 hour delivery window", () => {
    const createdAt = new Date("2026-10-07T00:00:00.000Z")
    const now = new Date(createdAt.getTime() + DELIVERY_WINDOW_MS - 1_000)

    expect(nextRetryAt(createdAt, 1, now)).toBeNull()
  })

  it("retries unknown outcomes only for the four accepted notification types", () => {
    expect(shouldRetryUnknown("customer-password-reset")).toBe(true)
    expect(shouldRetryUnknown("order-confirmation")).toBe(true)
    expect(shouldRetryUnknown("order-payment-confirmed")).toBe(true)
    expect(shouldRetryUnknown("shipping-return-status")).toBe(true)
    expect(shouldRetryUnknown("abandoned-cart-reminder")).toBe(false)
  })
})
