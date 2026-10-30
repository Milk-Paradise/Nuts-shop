import { encryptShippingProviderCredentials } from "../../../../modules/shipping-provider-registry/credentials"
import { serializeCdekProviderConfig } from "../serializers"

describe("shipping provider API serializers", () => {
  beforeEach(() => {
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "test-shipping-provider-key"
  })

  it("never returns CDEK credentials in plaintext", () => {
    const client_id = "abcd-client-id-wxyz"
    const client_secret = "1234-super-secret-9876"
    const response = serializeCdekProviderConfig({
      encrypted_credentials: encryptShippingProviderCredentials({
        client_id,
        client_secret,
      }),
      configuration: { contract_type: "online_store" },
    })
    const serialized = JSON.stringify(response)

    expect(serialized).not.toContain(client_id)
    expect(serialized).not.toContain(client_secret)
    expect(response.credentials).toEqual({
      client_id: "abcd***********wxyz",
      client_secret: "1234**************9876",
    })
    expect(response).not.toHaveProperty("encrypted_credentials")
  })
})
