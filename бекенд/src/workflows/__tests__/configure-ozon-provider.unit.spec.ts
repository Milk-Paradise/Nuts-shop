import { MedusaError } from "@medusajs/framework/utils"

import {
  resolveAndTestOzonCredentials,
  resolveOzonCredentials,
} from "../configure-ozon-provider"
import { OZON_PROVIDER_KEY } from "../../modules/shipping-provider-registry"
import { encryptShippingProviderCredentials } from "../../modules/shipping-provider-registry/credentials"

function container(
  config: unknown = null,
  registry = { testProviderCredentials: jest.fn() }
) {
  const service = {
    getProviderConfig: jest.fn().mockResolvedValue(config),
    ...registry,
  }
  return {
    resolve: jest.fn(() => service),
  } as any
}

describe("configure Ozon provider", () => {
  it("reuses stored credentials when the secret fields are omitted", async () => {
    const result = await resolveOzonCredentials(
      container({
        encrypted_credentials: encryptShippingProviderCredentials({
          client_id: "stored-id",
          client_secret: "stored-secret",
        }),
      }),
      { configuration: {} } as any
    )
    expect(result).toEqual({ client_id: "stored-id", client_secret: "stored-secret" })
  })

  it("rejects incomplete credentials before calling Ozon", async () => {
    const registry = { testProviderCredentials: jest.fn() }
    await expect(resolveAndTestOzonCredentials(
      container(null, registry),
      { configuration: {} }
    )).rejects.toMatchObject({ type: MedusaError.Types.INVALID_ARGUMENT })
    expect(registry.testProviderCredentials).not.toHaveBeenCalled()
  })

  it("tests credentials without exposing them to the workflow result", async () => {
    const registry = {
      testProviderCredentials: jest.fn().mockResolvedValue(undefined),
    }
    const result = await resolveAndTestOzonCredentials(
      container(null, registry),
      { client_id: "test-id", client_secret: "test-secret", configuration: {} }
    )
    expect(registry.testProviderCredentials).toHaveBeenCalledWith(
      OZON_PROVIDER_KEY,
      { client_id: "test-id", client_secret: "test-secret" }
    )
    expect(result).toEqual({ client_id: "test-id", client_secret: "test-secret" })
    expect(OZON_PROVIDER_KEY).toBe("ozon_ozon")
  })
})
