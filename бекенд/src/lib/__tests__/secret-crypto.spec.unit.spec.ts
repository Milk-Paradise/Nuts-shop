import {
  decryptSecret,
  encryptSecret,
  parseBase64EncryptionKey,
  SecretCryptoError,
} from "../secret-crypto"

const primaryKey = "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg="
const legacyPaymentKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="

const legacyPaymentSecret =
  "v1:AQEBAQEBAQEBAQEB:9rDWhj7cTVkx/mW+IgRLXw==:GoTu1vPGwX6wrbFEHkNdQs2YZpFs"
const legacyShippingCredentials =
  "v1.AgICAgICAgICAgIC.xRX1Jkx0CMJkJCf3nEqixA.A3Y2-n3P7e_rbKw7cRi8M0V8dW4mLi6x1H_rFhUS2RMc2lBnfFqGT5gntw19Kf66g2YPnHzw5x7IFyj-UjrgsuXqrsAGGQ"
const legacyMoyskladCredentials =
  "v1.AwMDAwMDAwMDAwMD.njAt0c5mBU7bui16IhernQ.rFcAQcmW5nAaVPPSCbsqeJNBbJwKdt2B4EK4fbvLHzHGO51TNazg-B1yZqEkDBlY"

describe("secret crypto", () => {
  const environment = { ...process.env }

  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = primaryKey
    process.env.PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY = legacyPaymentKey
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "legacy-shipping-key"
    process.env.MOYSKLAD_ENCRYPTION_KEY = "legacy-moysklad-key"
  })

  afterEach(() => {
    process.env = { ...environment }
  })

  it("round-trips a secret with the unified key and v2 format", () => {
    const encrypted = encryptSecret("secret-value-с-юникодом")

    expect(encrypted).toMatch(/^v2:/)
    expect(decryptSecret(encrypted, "payment-provider-config")).toEqual({
      plaintext: "secret-value-с-юникодом",
    })
  })

  it("uses a fresh IV for every encryption", () => {
    expect(encryptSecret("same-value")).not.toBe(encryptSecret("same-value"))
  })

  it("strictly validates canonical base64 keys", () => {
    expect(parseBase64EncryptionKey(primaryKey)).toHaveLength(32)
    expect(() => parseBase64EncryptionKey("not-a-valid-key")).toThrow(
      SecretCryptoError
    )
    expect(() =>
      parseBase64EncryptionKey(Buffer.alloc(31).toString("base64"))
    ).toThrow("base64-encoded 32-byte key")
  })

  it("names the primary variable when its key is invalid", () => {
    process.env.SECRET_ENCRYPTION_KEY = "not-a-valid-key"

    expect(() => encryptSecret("secret-value")).toThrow(
      "SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
    )
  })

  it("requires the primary key for new writes", () => {
    delete process.env.SECRET_ENCRYPTION_KEY

    expect(() => encryptSecret("secret-value")).toThrow(
      "SECRET_ENCRYPTION_KEY is required"
    )
  })

  it("reads legacy ciphertext before the primary key is deployed", () => {
    delete process.env.SECRET_ENCRYPTION_KEY

    expect(decryptSecret(legacyPaymentSecret, "payment-provider-config")).toEqual({
      plaintext: "legacy-payment-secret",
    })
  })

  it.each([
    [
      "payment provider",
      legacyPaymentSecret,
      "payment-provider-config",
      "legacy-payment-secret",
    ],
    [
      "shipping provider",
      legacyShippingCredentials,
      "shipping-provider-config",
      '{"client_id":"legacy-client","client_secret":"legacy-shipping-secret"}',
    ],
    [
      "MoySklad",
      legacyMoyskladCredentials,
      "moysklad-integration",
      '{"type":"token","token":"legacy-moysklad-token"}',
    ],
  ] as const)(
    "reads and prepares lazy migration for legacy %s ciphertext",
    (_, encrypted, kind, plaintext) => {
      const decrypted = decryptSecret(encrypted, kind)

      expect(decrypted.plaintext).toBe(plaintext)
      expect(decrypted.reencrypted).toMatch(/^v2:/)
      expect(decryptSecret(decrypted.reencrypted!, kind).plaintext).toBe(
        plaintext
      )
    }
  )

  it.each([
    "v2:not-base64:AAAAAAAAAAAAAAAAAAAAAA==:YQ==",
    "v2:AQEBAQEBAQEBAQEB:short:YQ==",
    "v2:AQEBAQEBAQEBAQEB:AAAAAAAAAAAAAAAAAAAAAA==:YQ==:extra",
  ])("rejects malformed v2 ciphertext: %s", (encrypted) => {
    expect(() => decryptSecret(encrypted, "payment-provider-config")).toThrow(
      SecretCryptoError
    )
  })

  it("does not fall back to a legacy key for corrupted v2 ciphertext", () => {
    const encrypted = encryptSecret("secret").split(":")
    encrypted[3] = `${encrypted[3][0] === "A" ? "B" : "A"}${encrypted[3].slice(1)}`

    expect(() =>
      decryptSecret(encrypted.join(":"), "payment-provider-config")
    ).toThrow("SECRET_ENCRYPTION_KEY")
  })
})
