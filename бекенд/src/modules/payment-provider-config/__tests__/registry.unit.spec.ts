import {
  listAvailablePaymentProviders,
  paymentProviderRegistryForEnvironment,
} from "../registry"

describe("payment provider registry e2e gate", () => {
  it("does not expose the e2e provider without E2E_RUN", async () => {
    expect(paymentProviderRegistryForEnvironment(false)).not.toContainEqual(
      expect.objectContaining({ id: "e2e" })
    )
  })

  it("exposes the e2e provider with E2E_RUN=true", async () => {
    expect(paymentProviderRegistryForEnvironment(true)).toContainEqual({
      id: "e2e",
      name: "E2E тестовая оплата",
      medusa_id: "pp_e2e_e2e",
    })
  })
})

describe("storefront payment provider selection", () => {
  const providers = paymentProviderRegistryForEnvironment(true)
  const configured = providers.map((provider, index) => ({
    id: `config-${index}`,
    provider_id: provider.id,
    shop_id: `shop-${index}`,
    encrypted_secret_key: `encrypted-${index}`,
    mode: "test" as const,
    is_enabled: true,
    created_by_user_id: "admin",
    updated_by_user_id: "admin",
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
  }))

  it("returns one, several, or no enabled providers", () => {
    expect(
      listAvailablePaymentProviders(
        configured,
        [{ provider_id: "yookassa", is_enabled: true } as any],
        providers
      )
    ).toEqual([{ id: "yookassa", name: "ЮKassa" }])

    expect(
      listAvailablePaymentProviders(
        configured,
        providers.map((provider) => ({
          provider_id: provider.id,
          is_enabled: true,
        })) as any,
        providers
      )
    ).toEqual([
      { id: "yookassa", name: "ЮKassa" },
      { id: "e2e", name: "E2E тестовая оплата" },
    ])

    expect(listAvailablePaymentProviders(configured, [], providers)).toEqual([])
  })

  it("does not expose disabled or incomplete providers", () => {
    const availability = providers.map((provider) => ({
      provider_id: provider.id,
      is_enabled: provider.id !== "yookassa",
    })) as any
    const incomplete = configured.map((config) =>
      config.provider_id === "e2e"
        ? { ...config, encrypted_secret_key: null }
        : config
    )

    expect(
      listAvailablePaymentProviders(incomplete, availability, providers)
    ).toEqual([])
  })
})
