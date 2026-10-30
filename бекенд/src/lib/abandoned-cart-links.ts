import { createHmac, timingSafeEqual } from "node:crypto"

function storefrontBase() {
  return process.env.STOREFRONT_URL ?? "http://localhost:8000"
}

// HMAC over JWT_SECRET rather than a full JWT: this only ever needs to prove
// "this customer_id/token pair wasn't forged or guessed" for one unauthenticated
// action (opting out of reminder emails), so a signed token with no separate
// verification library is enough — JWT_SECRET is already a required config
// value for this project (Medusa's own auth depends on it).
function unsubscribeSecret() {
  const secret = process.env.JWT_SECRET
  // Falling back to "" would sign with an empty key: createHmac accepts it, so
  // a missing config value would silently make the token guessable instead of
  // failing loudly.
  if (!secret) throw new Error("JWT_SECRET is required")
  return secret
}

export function signAbandonedCartUnsubscribeToken(customerId: string): string {
  return createHmac("sha256", unsubscribeSecret()).update(customerId).digest("hex")
}

export function verifyAbandonedCartUnsubscribeToken(customerId: string, token: string): boolean {
  const expected = signAbandonedCartUnsubscribeToken(customerId)
  const expectedBuffer = Buffer.from(expected)
  const tokenBuffer = Buffer.from(token)

  if (expectedBuffer.length !== tokenBuffer.length) return false

  return timingSafeEqual(expectedBuffer, tokenBuffer)
}

// Resuming a specific cart across devices needs an explicit id in the URL —
// the storefront's own "saved cart" is only ever read from that device's
// localStorage (see apps/web/lib/api/cart.ts), which the email
// recipient's browser/device won't have.
export function checkoutResumeUrl(cartId: string): string {
  const url = new URL("/cart", storefrontBase())
  url.searchParams.set("cart_id", cartId)
  return url.toString()
}

export function abandonedCartUnsubscribeUrl(customerId: string): string {
  const url = new URL("/unsubscribe/abandoned-cart", storefrontBase())
  url.searchParams.set("customer_id", customerId)
  url.searchParams.set("token", signAbandonedCartUnsubscribeToken(customerId))
  return url.toString()
}
