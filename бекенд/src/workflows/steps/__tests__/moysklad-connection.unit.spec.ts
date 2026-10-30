import {
  MoyskladApiError,
  MoyskladClient,
  type MoyskladFetch,
  type MoyskladFetchResponse,
} from "../../../modules/moysklad-integration/client"
import {
  configureMoyskladConnection,
  type MoyskladConnectionTester,
} from "../moysklad-connection"
import { ERP_INTEGRATION_REGISTRY_MODULE } from "../../../modules/erp-integration-registry"

const credentials = { type: "token" as const, token: "access-token" }

describe("configureMoyskladConnection", () => {
  it("does not replace the stored configuration when the connection test fails", async () => {
    const service = { saveConnectionConfig: jest.fn() }
    const registry = {
      registerIntegration: jest.fn(),
      setActiveIntegration: jest.fn(),
    }
    const container = {
      resolve: jest.fn((key: string) =>
        key === ERP_INTEGRATION_REGISTRY_MODULE ? registry : service
      ),
    }
    const client: MoyskladConnectionTester = {
      testCredentials: jest.fn().mockRejectedValue(
        new MoyskladApiError("Недействительный токен", 401)
      ),
    }

    await expect(
      configureMoyskladConnection(container as never, { credentials }, client)
    ).rejects.toThrow("Недействительный токен")

    expect(service.saveConnectionConfig).not.toHaveBeenCalled()
  })

  it("saves and activates the configuration after a successful connection test", async () => {
    const savedConfig = {
      id: "default",
      encrypted_credentials: "v1.encrypted",
      is_active: true,
    }
    const service = {
      saveConnectionConfig: jest.fn().mockResolvedValue(savedConfig),
    }
    const registry = {
      registerIntegration: jest.fn().mockResolvedValue({}),
      setActiveIntegration: jest.fn().mockResolvedValue({}),
    }
    const container = {
      resolve: jest.fn((key: string) =>
        key === ERP_INTEGRATION_REGISTRY_MODULE ? registry : service
      ),
    }
    const client: MoyskladConnectionTester = {
      testCredentials: jest.fn().mockResolvedValue({ success: true }),
    }

    await expect(
      configureMoyskladConnection(container as never, { credentials }, client)
    ).resolves.toEqual(savedConfig)

    expect(service.saveConnectionConfig).toHaveBeenCalledWith({
      credentials,
      isActive: true,
    })
    expect(registry.registerIntegration).toHaveBeenCalledWith({
      integrationKey: "moysklad",
      displayName: "МойСклад",
    })
    expect(registry.setActiveIntegration).toHaveBeenCalledWith({
      integrationKey: "moysklad",
    })
  })

  it("does not save credentials when the check returns unreadable JSON with HTTP 200", async () => {
    const service = { saveConnectionConfig: jest.fn() }
    const registry = {
      registerIntegration: jest.fn(),
      setActiveIntegration: jest.fn(),
    }
    const container = {
      resolve: jest.fn((key: string) =>
        key === ERP_INTEGRATION_REGISTRY_MODULE ? registry : service
      ),
    }
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "not-json",
      json: async () => Promise.reject(new SyntaxError("Unexpected token")),
    })
    const client = new MoyskladClient(fetch, {
      throttle: jest.fn().mockResolvedValue(undefined),
    })

    await expect(
      configureMoyskladConnection(container as never, { credentials }, client)
    ).rejects.toThrow("успешный статус с некорректным JSON")

    expect(service.saveConnectionConfig).not.toHaveBeenCalled()
  })
})
