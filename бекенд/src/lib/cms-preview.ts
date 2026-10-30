import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

type PreviewClaims = { exp: number; nonce: string }

const encode = (value: string) => Buffer.from(value).toString("base64url")

export function setPreviewResponseHeaders(res: { setHeader(name: string, value: string): unknown }) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0")
  res.setHeader("Pragma", "no-cache")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive")
}

export function createPreviewToken(secret: string, now = Date.now(), ttlMs = 10 * 60_000) {
  const payload = encode(JSON.stringify({ exp: now + ttlMs, nonce: randomUUID() }))
  const signature = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

export function verifyPreviewToken(token: string, secret: string, now = Date.now()): PreviewClaims | null {
  const [payload, signature, extra] = token.split(".")
  if (!payload || !signature || extra) return null
  const expected = createHmac("sha256", secret).update(payload).digest("base64url")
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PreviewClaims
    return Number.isFinite(claims.exp) && claims.exp > now && typeof claims.nonce === "string" ? claims : null
  } catch {
    return null
  }
}
