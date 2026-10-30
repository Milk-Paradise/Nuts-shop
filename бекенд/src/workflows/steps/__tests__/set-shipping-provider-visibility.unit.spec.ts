import {
  hasVerifiedCdekConfiguration,
  isShippingProviderConfigurationReady,
} from "../set-shipping-provider-visibility"
import { encryptShippingProviderCredentials } from "../../../modules/shipping-provider-registry/credentials"

const encryptedCredentials = () => {
  process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "test-readiness-key"
  return encryptShippingProviderCredentials({ client_id: "client", client_secret: "secret" })
}

const validConfiguration = {
  sender: { city: "Тула", street: "ул. Ленина, 1", postal_code: "300000", contact_name: "Иван", phone: "+70000000000" },
  contract_type: "delivery",
  tariff_codes: [136],
}

describe("hasVerifiedCdekConfiguration", () => {
  it("requires readable credentials and a complete carrier configuration", () => {
    expect(hasVerifiedCdekConfiguration(null)).toBe(false)
    expect(
      hasVerifiedCdekConfiguration({
        encrypted_credentials: encryptedCredentials(),
        configuration: { tariff_codes: [] },
      })
    ).toBe(false)
    expect(
      hasVerifiedCdekConfiguration({
        encrypted_credentials: encryptedCredentials(),
        configuration: validConfiguration,
      })
    ).toBe(true)
    expect(hasVerifiedCdekConfiguration({ encrypted_credentials: "invalid", configuration: validConfiguration })).toBe(false)
  })

  it("requires readable credentials for Ozon and accepts its optional settings", () => {
    expect(isShippingProviderConfigurationReady("ozon_ozon", {
      encrypted_credentials: encryptedCredentials(),
      configuration: {},
    })).toBe(true)
    expect(isShippingProviderConfigurationReady("ozon_ozon", {
      encrypted_credentials: "invalid",
      configuration: {},
    })).toBe(false)
  })
})
