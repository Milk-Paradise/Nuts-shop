import MoyskladIntegrationService from "../service"
import { encryptMoyskladCredentials } from "../credentials"
import { MoyskladClient, type MoyskladFetch, type MoyskladFetchResponse } from "../client"

const secretToken = "moysklad-secret-token-must-never-leak"
const secretPassword = "moysklad-secret-password-must-never-leak"

function assertNoLeaks(...secrets: string[]) {
  const consoleSpy = [
    console.log,
    console.info,
    console.warn,
    console.error,
  ] as jest.Mock[]

  for (const spy of consoleSpy) {
    for (const call of spy.mock.calls) {
      const serialized = JSON.stringify(call)

      for (const secret of secrets) {
        expect(serialized).not.toContain(secret)
      }
    }
  }
}

describe("MoySklad credentials security", () => {
  beforeEach(() => {
    process.env.MOYSKLAD_ENCRYPTION_KEY = "test-moysklad-encryption-key"
    jest.spyOn(console, "log").mockImplementation(() => undefined)
    jest.spyOn(console, "info").mockImplementation(() => undefined)
    jest.spyOn(console, "warn").mockImplementation(() => undefined)
    jest.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("never logs the secret while saving token credentials", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getConnectionConfig").mockResolvedValue(null as never)
    jest
      .spyOn(service, "createMoyskladConnectionConfigs")
      .mockImplementation((async (input: never) => input) as never)

    await service.saveConnectionConfig({
      credentials: { type: "token", token: secretToken },
      isActive: true,
    })

    assertNoLeaks(secretToken)
  })

  it("never logs the secret while saving login/password credentials", async () => {
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "getConnectionConfig").mockResolvedValue(null as never)
    jest
      .spyOn(service, "createMoyskladConnectionConfigs")
      .mockImplementation((async (input: never) => input) as never)

    await service.saveConnectionConfig({
      credentials: {
        type: "basic",
        login: "manager@example.com",
        password: secretPassword,
      },
      isActive: true,
    })

    assertNoLeaks(secretPassword)
  })

  it("never logs the secret on a successful test connection", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" })
    const client = new MoyskladClient(fetch)

    await client.testConnection(
      encryptMoyskladCredentials({ type: "token", token: secretToken })
    )

    assertNoLeaks(secretToken)
  })

  it("never logs the secret when the test connection fails", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Недействительный токен",
    })
    const client = new MoyskladClient(fetch)

    await expect(
      client.testConnection(
        encryptMoyskladCredentials({ type: "token", token: secretToken })
      )
    ).rejects.toThrow()

    assertNoLeaks(secretToken)
  })

  it("never logs the secret when the request itself fails", async () => {
    const fetch = jest.fn<
      Promise<MoyskladFetchResponse>,
      Parameters<MoyskladFetch>
    >().mockRejectedValue(new Error("socket hang up"))
    const client = new MoyskladClient(fetch)

    await expect(
      client.testConnection(
        encryptMoyskladCredentials({
          type: "basic",
          login: "manager@example.com",
          password: secretPassword,
        })
      )
    ).rejects.toThrow()

    assertNoLeaks(secretPassword)
  })

  it("never re-exposes the plaintext secret on repeated reads of the stored configuration", async () => {
    const encryptedCredentials = encryptMoyskladCredentials({
      type: "token",
      token: secretToken,
    })
    const service = Object.create(MoyskladIntegrationService.prototype) as MoyskladIntegrationService

    jest.spyOn(service, "listMoyskladConnectionConfigs").mockResolvedValue([
      { id: "default", encrypted_credentials: encryptedCredentials, is_active: true },
    ] as never)

    const config = await service.getConnectionConfig()
    const firstRead = JSON.stringify(config)

    jest.spyOn(service, "listMoyskladConnectionConfigs").mockResolvedValue([
      { id: "default", encrypted_credentials: encryptedCredentials, is_active: true },
    ] as never)

    const secondRead = JSON.stringify(await service.getConnectionConfig())

    expect(firstRead).not.toContain(secretToken)
    expect(secondRead).not.toContain(secretToken)
  })
})
