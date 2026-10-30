import {
  abandonedCartUnsubscribeUrl,
  checkoutResumeUrl,
  signAbandonedCartUnsubscribeToken,
  verifyAbandonedCartUnsubscribeToken,
} from "../abandoned-cart-links"

describe("checkoutResumeUrl", () => {
  it("points at the cart page with the specific cart id (resume on any device)", () => {
    const url = new URL(checkoutResumeUrl("cart_123"))

    expect(url.pathname).toBe("/cart")
    expect(url.searchParams.get("cart_id")).toBe("cart_123")
  })
})

describe("abandonedCartUnsubscribeUrl", () => {
  it("carries the customer id and a verifiable token", () => {
    const url = new URL(abandonedCartUnsubscribeUrl("cus_123"))

    expect(url.pathname).toBe("/unsubscribe/abandoned-cart")
    expect(url.searchParams.get("customer_id")).toBe("cus_123")

    const token = url.searchParams.get("token")
    expect(token).toBeTruthy()
    expect(verifyAbandonedCartUnsubscribeToken("cus_123", token as string)).toBe(true)
  })
})

describe("abandoned-cart unsubscribe token", () => {
  it("throws when JWT_SECRET is empty", () => {
    const originalSecret = process.env.JWT_SECRET
    process.env.JWT_SECRET = ""

    try {
      expect(() => signAbandonedCartUnsubscribeToken("cus_123")).toThrow("JWT_SECRET is required")
    } finally {
      if (originalSecret === undefined) delete process.env.JWT_SECRET
      else process.env.JWT_SECRET = originalSecret
    }
  })

  it("rejects a token signed for a different customer", () => {
    const token = signAbandonedCartUnsubscribeToken("cus_123")
    expect(verifyAbandonedCartUnsubscribeToken("cus_456", token)).toBe(false)
  })

  it("rejects a tampered token", () => {
    const token = signAbandonedCartUnsubscribeToken("cus_123")
    expect(verifyAbandonedCartUnsubscribeToken("cus_123", `${token}0`)).toBe(false)
    expect(verifyAbandonedCartUnsubscribeToken("cus_123", token.slice(0, -1))).toBe(false)
  })

  it("rejects an empty token without throwing", () => {
    expect(verifyAbandonedCartUnsubscribeToken("cus_123", "")).toBe(false)
  })
})
