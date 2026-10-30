import { encryptShippingProviderCredentials } from "../../../../../../modules/shipping-provider-registry/credentials"
import { listCdekTariffs } from "../route"

describe("CDEK tariff route", () => {
  beforeEach(() => {
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "test-shipping-provider-key"
  })

  it("uses stored credentials through the registry and returns no plaintext secret", async () => {
    const clientSecret = "stored-client-secret-must-not-leak"
    const service = {
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({
          client_id: "stored-client-id",
          client_secret: clientSecret,
        }),
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 1000,
        length_mm: 300,
        width_mm: 200,
        height_mm: 150,
      }),
      listCdekTariffs: jest.fn().mockResolvedValue([
        { code: 136, name: "Посылка склад — склад" },
      ]),
    }
    const container = {
      resolve: jest.fn().mockReturnValue(service),
    }
    const result = await listCdekTariffs(
      container as never,
      {
        contract_type: "online_store",
        sender: { city: "Москва", postal_code: "101000" },
      }
    )

    expect(service.listCdekTariffs).toHaveBeenCalledWith(
      { client_id: "stored-client-id", client_secret: clientSecret },
      expect.objectContaining({
        package: { weight_grams: 1000, length_mm: 300, width_mm: 200, height_mm: 150 },
      })
    )
    expect(result).toEqual([{ code: 136, name: "Посылка склад — склад" }])
    expect(JSON.stringify(result)).not.toContain(clientSecret)
  })

  it("refuses to list tariffs without the stored store package", async () => {
    const service = {
      getProviderConfig: jest.fn(),
      getStorePackage: jest.fn().mockResolvedValue(null),
    }
    const container = { resolve: jest.fn().mockReturnValue(service) }

    await expect(listCdekTariffs(
      container as never,
      { contract_type: "online_store", sender: { city: "Москва", postal_code: "101000" } }
    )).rejects.toThrow("Коробка магазина не задана")
  })
})
