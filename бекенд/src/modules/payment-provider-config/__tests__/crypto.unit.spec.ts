import {
  decryptPaymentProviderSecret,
  encryptPaymentProviderSecret,
  PaymentProviderConfigEncryptionError,
} from "../crypto"
import {
  buildPaymentProviderConfigWriteData,
  toAdminPaymentProviderConfig,
  type PaymentProviderConfigRecord,
} from "../storage"
import { listAdminPaymentProviders } from "../registry"

const key = Buffer.alloc(32, 7).toString("base64")

describe("payment provider secret encryption", () => {
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = key
  })

  it("encrypts a secret without persisting it in plaintext", () => {
    const secret = "test_secret_key"
    const encrypted = encryptPaymentProviderSecret(secret)

    expect(encrypted).not.toContain(secret)
    expect(decryptPaymentProviderSecret(encrypted)).toBe(secret)
  })

  it("rejects malformed encryption keys", () => {
    process.env.SECRET_ENCRYPTION_KEY = "not-a-valid-key"

    expect(() => encryptPaymentProviderSecret("secret")).toThrow(
      PaymentProviderConfigEncryptionError
    )
  })

  it("rejects ciphertext that has been modified", () => {
    const encrypted = encryptPaymentProviderSecret("secret")
    const parts = encrypted.split(":")
    const ciphertext = parts[3]
    parts[3] = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`

    expect(() => decryptPaymentProviderSecret(parts.join(":"))).toThrow(
      PaymentProviderConfigEncryptionError
    )
  })

  it("uses the shared encryption key from the environment for storage writes", () => {
    const writeData = buildPaymentProviderConfigWriteData(
      {
        provider_id: "yookassa",
        shop_id: "shop-1",
        secret_key: "test_secret_key",
        actor_id: "user_1",
      },
      null
    )

    expect(writeData.encrypted_secret_key).not.toContain("test_secret_key")
    expect(decryptPaymentProviderSecret(writeData.encrypted_secret_key!)).toBe(
      "test_secret_key"
    )
    expect(writeData.created_by_user_id).toBe("user_1")
    expect(writeData.updated_by_user_id).toBe("user_1")
  })

  it("preserves the previous secret while recording the updating actor", () => {
    const existing: PaymentProviderConfigRecord = {
      id: "ppc_1",
      provider_id: "yookassa",
      shop_id: "shop-1",
      encrypted_secret_key: encryptPaymentProviderSecret("old_secret"),
      mode: "test",
      is_enabled: true,
      created_by_user_id: "user_1",
      updated_by_user_id: "user_1",
      created_at: new Date(),
      updated_at: new Date(),
    }
    const writeData = buildPaymentProviderConfigWriteData(
      { provider_id: "yookassa", mode: "live", actor_id: "user_2" },
      existing
    )

    expect(writeData.encrypted_secret_key).toBe(existing.encrypted_secret_key)
    expect(writeData.created_by_user_id).toBe("user_1")
    expect(writeData.updated_by_user_id).toBe("user_2")
    expect(toAdminPaymentProviderConfig(existing)).toEqual(
      expect.objectContaining({ secret_key_set: true })
    )
    expect(toAdminPaymentProviderConfig(existing)).not.toHaveProperty(
      "encrypted_secret_key"
    )
  })

  it("preserves an existing secret when an edit sends an empty value", () => {
    const existing: PaymentProviderConfigRecord = {
      id: "ppc_1",
      provider_id: "yookassa",
      shop_id: "shop-1",
      encrypted_secret_key: encryptPaymentProviderSecret("old_secret"),
      mode: "test",
      is_enabled: true,
      created_by_user_id: "user_1",
      updated_by_user_id: "user_1",
      created_at: new Date(),
      updated_at: new Date(),
    }

    const writeData = buildPaymentProviderConfigWriteData(
      { provider_id: "yookassa", secret_key: "", actor_id: "user_2" },
      existing
    )

    expect(writeData.encrypted_secret_key).toBe(existing.encrypted_secret_key)
    expect(writeData.is_enabled).toBe(true)
  })

  it("disables the provider when credentials are replaced", () => {
    const existing: PaymentProviderConfigRecord = {
      id: "ppc_1",
      provider_id: "yookassa",
      shop_id: "shop-1",
      encrypted_secret_key: encryptPaymentProviderSecret("old_secret"),
      mode: "test",
      is_enabled: true,
      created_by_user_id: "user_1",
      updated_by_user_id: "user_1",
      created_at: new Date(),
      updated_at: new Date(),
    }

    const writeData = buildPaymentProviderConfigWriteData(
      {
        provider_id: "yookassa",
        shop_id: "shop-2",
        secret_key: "new_secret",
        actor_id: "user_2",
      },
      existing
    )

    expect(writeData.shop_id).toBe("shop-2")
    expect(decryptPaymentProviderSecret(writeData.encrypted_secret_key!)).toBe(
      "new_secret"
    )
    expect(writeData.is_enabled).toBe(false)
  })

  it("revokes and removes a stored secret", () => {
    const existing: PaymentProviderConfigRecord = {
      id: "ppc_1",
      provider_id: "yookassa",
      shop_id: "shop-1",
      encrypted_secret_key: encryptPaymentProviderSecret("old_secret"),
      mode: "test",
      is_enabled: true,
      created_by_user_id: "user_1",
      updated_by_user_id: "user_1",
      created_at: new Date(),
      updated_at: new Date(),
    }

    const writeData = buildPaymentProviderConfigWriteData(
      { provider_id: "yookassa", secret_key: null, actor_id: "user_2" },
      existing
    )
    const response = toAdminPaymentProviderConfig({
      ...existing,
      ...writeData,
    })

    expect(writeData.encrypted_secret_key).toBeNull()
    expect(writeData.is_enabled).toBe(false)
    expect(response.secret_key_set).toBe(false)
    expect(response).not.toHaveProperty("encrypted_secret_key")
    expect(JSON.stringify(response)).not.toContain("old_secret")
  })

  it("disables new payments while preserving credentials for existing sessions", () => {
    const existing: PaymentProviderConfigRecord = {
      id: "ppc_1",
      provider_id: "yookassa",
      shop_id: "shop-1",
      encrypted_secret_key: encryptPaymentProviderSecret("old_secret"),
      mode: "test",
      is_enabled: true,
      created_by_user_id: "user_1",
      updated_by_user_id: "user_1",
      created_at: new Date(),
      updated_at: new Date(),
    }

    const writeData = buildPaymentProviderConfigWriteData(
      { provider_id: "yookassa", shop_id: null, actor_id: "user_2" },
      existing
    )

    expect(writeData.shop_id).toBe("shop-1")
    expect(writeData.encrypted_secret_key).toBe(existing.encrypted_secret_key)
    expect(writeData.is_enabled).toBe(false)
  })

  it("returns every registered provider without exposing encrypted secrets", () => {
    const config: PaymentProviderConfigRecord = {
      id: "ppc_1",
      provider_id: "yookassa",
      shop_id: "shop-1",
      encrypted_secret_key: encryptPaymentProviderSecret("secret"),
      mode: "live",
      is_enabled: true,
      created_by_user_id: "user_1",
      updated_by_user_id: "user_1",
      created_at: new Date(),
      updated_at: new Date(),
    }

    const [provider] = listAdminPaymentProviders([config])

    expect(provider).toEqual(
      expect.objectContaining({
        id: "yookassa",
        is_enabled: true,
        is_configured: true,
        configuration_status: "configured",
        secret_key_set: true,
      })
    )
    expect(provider).not.toHaveProperty("encrypted_secret_key")
  })
})
