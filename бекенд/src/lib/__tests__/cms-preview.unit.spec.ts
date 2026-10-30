import { createPreviewToken, setPreviewResponseHeaders, verifyPreviewToken } from "../cms-preview"

it("accepts a valid preview token and rejects tampering or expiry", () => {
  const now = 1_700_000_000_000
  const token = createPreviewToken("secret", now, 60_000)
  expect(verifyPreviewToken(token, "secret", now)).not.toBeNull()
  expect(verifyPreviewToken(`${token}x`, "secret", now)).toBeNull()
  expect(verifyPreviewToken(token, "secret", now + 60_001)).toBeNull()
})

it("sets the complete private preview response policy", () => {
  const headers = new Map<string, string>()
  setPreviewResponseHeaders({ setHeader: (name, value) => headers.set(name, value) })
  expect(Object.fromEntries(headers)).toEqual({
    "Cache-Control": "private, no-store, max-age=0",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  })
})
