import ShippingProviderRegistryModuleService from "../service"
import { resolveAndTestCdekCredentials } from "../../../workflows/configure-cdek-provider"
import { CDEK_PROVIDER_KEY } from ".."

const clientId = "cdek-client-id-must-not-leak"
const clientSecret = "cdek-client-secret-must-not-leak"

function expectNoSecretInConsole() {
  for (const spy of [console.log, console.info, console.warn, console.error] as jest.Mock[]) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain(clientId)
    expect(JSON.stringify(spy.mock.calls)).not.toContain(clientSecret)
  }
}

describe("shipping provider credential security", () => {
  beforeEach(() => {
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "test-shipping-provider-key"
    jest.spyOn(console, "log").mockImplementation(() => undefined)
    jest.spyOn(console, "info").mockImplementation(() => undefined)
    jest.spyOn(console, "warn").mockImplementation(() => undefined)
    jest.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  it("does not log plaintext credentials while persisting them", async () => {
    const service = Object.create(
      ShippingProviderRegistryModuleService.prototype
    ) as ShippingProviderRegistryModuleService
    jest.spyOn(service, "getProviderConfig").mockResolvedValue(null as never)
    jest.spyOn(service, "createShippingProviderConfigs").mockImplementation(
      (async (input: never) => input) as never
    )

    const stored = await service.saveProviderConfig({
      providerKey: "cdek_cdek",
      credentials: { client_id: clientId, client_secret: clientSecret },
      configuration: {},
    })

    expect(JSON.stringify(stored)).not.toContain(clientId)
    expect(JSON.stringify(stored)).not.toContain(clientSecret)
    expectNoSecretInConsole()
  })

  it("uses the CDEK adapter for authorization without logging secrets", async () => {
    const testProviderCredentials = jest.fn().mockResolvedValue(undefined)
    const service = {
      getProviderConfig: jest.fn().mockResolvedValue(null),
      testProviderCredentials,
    }
    const container = {
      resolve: jest.fn(() => service),
    }

    await resolveAndTestCdekCredentials(
      container as never,
      {
        client_id: clientId,
        client_secret: clientSecret,
        configuration: {
          sender: {
            city: "Москва",
            street: "Тестовая, 1",
            postal_code: "101000",
            contact_name: "Тест",
            phone: "+79990000000",
          },
          contract_type: "online_store",
          tariff_codes: [136],
        },
      }
    )

    expect(testProviderCredentials).toHaveBeenCalledWith(
      CDEK_PROVIDER_KEY,
      { client_id: clientId, client_secret: clientSecret }
    )
    expectNoSecretInConsole()
  })
})
