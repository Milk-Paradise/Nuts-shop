import { asValue, createContainer } from "@medusajs/framework/awilix"
import { errorHandler } from "@medusajs/framework/http"
import { POST } from "../route"

// Exercise the real workflow and Medusa's HTTP error mapping.
describe("Telegram webhook route", () => {
  const originalEnv = { ...process.env }
  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_USERNAME
    delete process.env.TELEGRAM_WEBHOOK_SECRET
  })
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  function fixture(settings: unknown[] = [{ id: "telegram", enabled: true, encrypted_credentials: "encrypted" }]) {
    const service = {
      listNotificationChannelSettings: jest.fn().mockResolvedValue(settings),
      retrieveRuntimeChannelCredentials: jest.fn().mockResolvedValue({ bot_username: "catalog_bot", webhook_secret: "webhook-secret" }),
      consumeTelegramBindingToken: jest.fn().mockResolvedValue({ status: "linked", account_id: "customer_1" }),
    }
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
    const scope = createContainer()
    scope.register({
      notificationDomain: asValue(service),
      logger: asValue(logger),
      locking: asValue({ execute: async (_key: string, callback: () => unknown) => callback() }),
    })
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }
    async function request(secret?: string) {
      const req = {
        scope,
        headers: { "x-telegram-bot-api-secret-token": secret },
        body: { message: { text: "/start token", chat: { id: 42 } } },
      }
      try {
        await POST(req as never, res as never)
      } catch (error) {
        errorHandler()(error, req as never, res as never, jest.fn())
      }
    }
    return { service, logger, res, request }
  }

  it.each([{ settings: [] }, { settings: [{ id: "telegram", enabled: true }] }])("returns 503 without credentials for settings $settings", async ({ settings }) => {
    const { service, logger, res, request } = fixture(settings)
    await request()
    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({ message: "Telegram channel is not configured" })
    expect(service.consumeTelegramBindingToken).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it.each(["bot_username", "webhook_secret"])("returns 503 when %s is missing", async (missing) => {
    const { service, logger, res, request } = fixture()
    service.retrieveRuntimeChannelCredentials.mockResolvedValue({
      bot_username: "catalog_bot", webhook_secret: "webhook-secret", [missing]: undefined,
    })
    await request("wrong-secret")
    expect(res.status).toHaveBeenCalledWith(503)
    expect(logger.error).not.toHaveBeenCalled()
    expect(service.consumeTelegramBindingToken).not.toHaveBeenCalled()
  })

  it.each([undefined, "wrong-secret"])("returns 401 for secret %s when configured", async (secret) => {
    const { service, res, request } = fixture()
    await request(secret)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(service.consumeTelegramBindingToken).not.toHaveBeenCalled()
  })

  it("binds the customer with a valid secret", async () => {
    const { service, res, request } = fixture()
    await request("webhook-secret")
    expect(res.json).toHaveBeenCalledWith({ result: { status: "linked", account_id: "customer_1" } })
    expect(service.consumeTelegramBindingToken).toHaveBeenCalledWith(expect.any(String), "42", expect.any(Date), null, null)
  })

  it("uses environment credentials when the settings record is absent", async () => {
    process.env.TELEGRAM_BOT_USERNAME = "catalog_bot"
    process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret"
    const { res, request } = fixture([])
    await request("webhook-secret")
    expect(res.json).toHaveBeenCalledWith({ result: { status: "rejected", reason: "channel_disabled" } })
  })
})
