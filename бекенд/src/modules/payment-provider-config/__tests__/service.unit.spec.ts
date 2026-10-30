import PaymentProviderConfigModuleService from "../service"
import { encryptPaymentProviderSecret } from "../crypto"

const encryptionKey = Buffer.alloc(32, 4).toString("base64")
const legacyPaymentKey = Buffer.alloc(32, 7).toString("base64")
const legacyPaymentSecret =
  "v1:AQEBAQEBAQEBAQEB:9rDWhj7cTVkx/mW+IgRLXw==:GoTu1vPGwX6wrbFEHkNdQs2YZpFs"

function serviceWith(configurations: any[], availability: any[] = []) {
  const service = Object.create(
    PaymentProviderConfigModuleService.prototype
  ) as PaymentProviderConfigModuleService

  jest
    .spyOn(service, "listPaymentProviderConfigs")
    .mockResolvedValue(configurations as never)
  jest
    .spyOn(service, "listPaymentProviderAvailabilities")
    .mockResolvedValue(availability as never)

  return service
}

describe("PaymentProviderConfigModuleService", () => {
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = encryptionKey
  })

  it("creates a new configuration with an encrypted secret", async () => {
    const service = serviceWith([])
    const create = jest
      .spyOn(service, "createPaymentProviderConfigs")
      .mockImplementation(async (input) => input as never)

    await service.savePaymentProviderConfig({
      provider_id: "yookassa",
      shop_id: "shop-1",
      secret_key: "secret-value",
      is_enabled: true,
      actor_id: "user-1",
    })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_id: "yookassa",
        shop_id: "shop-1",
        is_enabled: true,
        encrypted_secret_key: expect.not.stringContaining("secret-value"),
      })
    )
  })

  it("updates an existing configuration without replacing an omitted secret", async () => {
    const encrypted = encryptPaymentProviderSecret("old-secret")
    const service = serviceWith([
      {
        id: "config-1",
        provider_id: "yookassa",
        shop_id: "shop-1",
        encrypted_secret_key: encrypted,
        mode: "test",
        is_enabled: true,
        created_by_user_id: "user-1",
      },
    ])
    const update = jest
      .spyOn(service, "updatePaymentProviderConfigs")
      .mockImplementation(async (input) => input as never)

    await service.savePaymentProviderConfig({
      provider_id: "yookassa",
      mode: "live",
      actor_id: "user-2",
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "config-1",
        encrypted_secret_key: encrypted,
        mode: "live",
        updated_by_user_id: "user-2",
      })
    )
  })

  it("re-encrypts a legacy secret when it is read at runtime", async () => {
    process.env.PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY = legacyPaymentKey
    const service = serviceWith([
      {
        id: "config-1",
        provider_id: "yookassa",
        shop_id: "shop-1",
        encrypted_secret_key: legacyPaymentSecret,
        mode: "test",
        is_enabled: true,
      },
    ])
    const update = jest
      .spyOn(service, "updatePaymentProviderConfigs")
      .mockImplementation(async (input) => input as never)

    await expect(
      service.retrieveRuntimePaymentProviderConfig("yookassa")
    ).resolves.toEqual(
      expect.objectContaining({ secret_key: "legacy-payment-secret" })
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "config-1",
        encrypted_secret_key: expect.stringMatching(/^v2:/),
      })
    )
  })

  it("returns safe admin and filtered storefront views", async () => {
    const configured = {
      id: "config-1",
      provider_id: "yookassa",
      shop_id: "shop-1",
      encrypted_secret_key: encryptPaymentProviderSecret("secret"),
      mode: "live",
      is_enabled: true,
      created_by_user_id: "user-1",
      updated_by_user_id: "user-1",
      created_at: new Date("2026-01-01T00:00:00Z"),
      updated_at: new Date("2026-01-02T00:00:00Z"),
    }
    const service = serviceWith([configured], [
      {
        provider_id: "yookassa",
        store_id: "store-1",
        region_id: "region-1",
        is_enabled: true,
      },
    ])

    await expect(
      service.retrieveAdminPaymentProviderConfig("yookassa")
    ).resolves.toEqual(expect.objectContaining({ secret_key_set: true }))
    await expect(service.listAdminPaymentProviders()).resolves.toEqual([
      expect.objectContaining({ id: "yookassa", is_enabled: true }),
    ])
    await expect(
      service.listStorePaymentProviders({
        store_id: "store-1",
        region_id: "region-1",
      })
    ).resolves.toEqual([
      { id: "yookassa", name: "ЮKassa" },
    ])
  })

  it.each([
    ["store-without-payments", "region-1"],
    ["store-1", "region-without-payments"],
  ])(
    "returns no storefront providers for unavailable scope %s/%s",
    async (storeId, regionId) => {
      const configured = {
        provider_id: "yookassa",
        shop_id: "shop-1",
        encrypted_secret_key: "encrypted",
        mode: "test",
        is_enabled: true,
      }
      const service = serviceWith([configured], [])

      await expect(
        service.listStorePaymentProviders({
          store_id: storeId,
          region_id: regionId,
        })
      ).resolves.toEqual([])
      expect(service.listPaymentProviderAvailabilities).toHaveBeenCalledWith({
        store_id: storeId,
        region_id: regionId,
        is_enabled: true,
      })
    }
  )

  it("removes a disabled provider from the next storefront read", async () => {
    const configured = {
      provider_id: "yookassa",
      shop_id: "shop-1",
      encrypted_secret_key: "encrypted",
      mode: "test",
      is_enabled: true,
    }
    const service = serviceWith([configured], [
      { provider_id: "yookassa", is_enabled: true },
    ])

    await expect(
      service.listStorePaymentProviders({
        store_id: "store-1",
        region_id: "region-1",
      })
    ).resolves.toHaveLength(1)
    configured.is_enabled = false
    await expect(
      service.listStorePaymentProviders({
        store_id: "store-1",
        region_id: "region-1",
      })
    ).resolves.toEqual([])
  })

  it("returns null for missing or incomplete runtime configuration", async () => {
    const missing = serviceWith([])
    await expect(
      missing.retrieveAdminPaymentProviderConfig("yookassa")
    ).resolves.toBeNull()
    await expect(
      missing.retrieveRuntimePaymentProviderConfig("yookassa")
    ).resolves.toBeNull()

    const incomplete = serviceWith([
      { provider_id: "yookassa", shop_id: " ", encrypted_secret_key: null },
    ])
    await expect(
      incomplete.retrieveRuntimePaymentProviderConfig("yookassa")
    ).resolves.toBeNull()
  })

  it("decrypts a complete runtime configuration", async () => {
    const service = serviceWith([
      {
        provider_id: "yookassa",
        shop_id: "shop-1",
        encrypted_secret_key: encryptPaymentProviderSecret("secret"),
        mode: "test",
        is_enabled: false,
      },
    ])

    await expect(
      service.retrieveRuntimePaymentProviderConfig("yookassa")
    ).resolves.toEqual({
      provider_id: "yookassa",
      shop_id: "shop-1",
      secret_key: "secret",
      mode: "test",
      is_enabled: false,
    })
  })
})
