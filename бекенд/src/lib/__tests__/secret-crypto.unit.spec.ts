import {
  decryptSecret,
  encryptSecret,
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

  it("round-trips a secret with the unified key and format", () => {
    const encrypted = encryptSecret("secret-value")

    expect(encrypted).toMatch(/^v2:/)
    expect(decryptSecret(encrypted, "payment-provider-config")).toEqual({
      plaintext: "secret-value",
      reencrypted: undefined,
    })
  })

  it("names the primary variable and expected format for an invalid key", () => {
    process.env.SECRET_ENCRYPTION_KEY = "not-a-valid-key"

    expect(() => encryptSecret("secret-value")).toThrow(SecretCryptoError)
    expect(() => encryptSecret("secret-value")).toThrow(
      "SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
    )
  })

  it("reads legacy ciphertext before the primary key is deployed", () => {
    delete process.env.SECRET_ENCRYPTION_KEY

    expect(decryptSecret(legacyPaymentSecret, "payment-provider-config")).toEqual({
      plaintext: "legacy-payment-secret",
      reencrypted: undefined,
    })
  })

  it.each([
    ["payment provider", legacyPaymentSecret, "payment-provider-config", "legacy-payment-secret"],
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
  ] as const)("reads and re-encrypts legacy %s ciphertext", (_, encrypted, kind, plaintext) => {
    const decrypted = decryptSecret(encrypted, kind)

    expect(decrypted.plaintext).toBe(plaintext)
    expect(decrypted.reencrypted).toMatch(/^v2:/)
    expect(decryptSecret(decrypted.reencrypted!, kind).plaintext).toBe(plaintext)
  })
})
