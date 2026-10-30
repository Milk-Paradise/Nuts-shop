import {
  decryptShippingProviderCredentials,
  encryptShippingProviderCredentials,
  maskShippingProviderSecret,
} from "../credentials"

describe("shipping provider credentials", () => {
  beforeEach(() => {
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "test-shipping-provider-key"
  })

  it("encrypts credentials at rest and decrypts them only explicitly", () => {
    const credentials = {
      client_id: "client-id-secret-value",
      client_secret: "client-secret-must-not-leak",
    }
    const encrypted = encryptShippingProviderCredentials(credentials)

    expect(encrypted).not.toContain(credentials.client_id)
    expect(encrypted).not.toContain(credentials.client_secret)
    expect(decryptShippingProviderCredentials(encrypted)).toEqual(credentials)
  })

  it("masks long secrets using only their first and last four characters", () => {
    expect(maskShippingProviderSecret("abcd-secret-efgh")).toBe("abcd********efgh")
    expect(maskShippingProviderSecret("short")).toBe("*****")
  })
})
