import { NotificationChannelVerifier } from "../channel-verification"
import { configureNotificationChannel } from "../../../workflows/steps/notification-channel-settings"

const expectedUrl = "https://backend.example.test/hooks/telegram"
const credentials = { bot_token: "123:token", webhook_secret: "secret" }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe("Telegram webhook verification", () => {
  const originalUrl = process.env.MEDUSA_BACKEND_URL
  beforeEach(() => { process.env.MEDUSA_BACKEND_URL = "https://backend.example.test/" })
  afterEach(() => {
    if (originalUrl === undefined) delete process.env.MEDUSA_BACKEND_URL
    else process.env.MEDUSA_BACKEND_URL = originalUrl
  })

  it.each([
    ["", "missing"],
    ["https://other.example.test/hook", "foreign"],
    [expectedUrl, "ok"],
  ])("persists %s as %s without blocking credentials", async (url, status) => {
    const request = jest.fn()
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ ok: true, result: { url } }))
    const replaceChannelCredentials = jest.fn().mockResolvedValue({ verified_at: new Date() })
    await configureNotificationChannel(
      { resolve: jest.fn().mockReturnValue({ replaceChannelCredentials }) } as never,
      { channel: "telegram", credentials },
      new NotificationChannelVerifier(request)
    )
    const webhook = replaceChannelCredentials.mock.calls[0][0].webhook
    expect(webhook).toEqual({
      status, expected_url: expectedUrl, checked_at: expect.any(String),
      ...(status === "foreign" ? { url } : {}),
    })
    expect(Number.isNaN(Date.parse(webhook.checked_at))).toBe(false)
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://api.telegram.org/bot123%3Atoken/getMe",
      "https://api.telegram.org/bot123%3Atoken/getWebhookInfo",
    ])
    expect(request.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal)
  })

  it.each(["network", "timeout", "http", "not-ok", "malformed"])(
    "keeps token verification successful on %s failure", async (failure) => {
      const request = jest.fn().mockResolvedValueOnce(response({ ok: true }))
      if (failure === "network" || failure === "timeout") {
        request.mockRejectedValueOnce(new Error(failure))
      } else {
        request.mockResolvedValueOnce(response(
          failure === "not-ok" ? { ok: false } : { ok: true, result: {} },
          failure === "http" ? 503 : 200
        ))
      }
      const replaceChannelCredentials = jest.fn().mockResolvedValue({ enabled: true })
      await expect(configureNotificationChannel(
        { resolve: jest.fn().mockReturnValue({ replaceChannelCredentials }) } as never,
        { channel: "telegram", credentials },
        new NotificationChannelVerifier(request)
      )).resolves.toEqual({ enabled: true })
      expect(replaceChannelCredentials.mock.calls[0][0].webhook).toEqual({
        status: "unknown", expected_url: expectedUrl, checked_at: expect.any(String),
      })
    }
  )

  it("records unknown when MEDUSA_BACKEND_URL is absent", async () => {
    delete process.env.MEDUSA_BACKEND_URL
    const request = jest.fn().mockResolvedValue(response({ ok: true }))
    await expect(new NotificationChannelVerifier(request).verify("telegram", credentials))
      .resolves.toEqual({ webhook: { status: "unknown", expected_url: "", checked_at: expect.any(String) } })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("does not check the webhook after a rejected token", async () => {
    const request = jest.fn().mockResolvedValue(response({ ok: false }))
    await expect(new NotificationChannelVerifier(request).verify("telegram", credentials))
      .rejects.toThrow("Telegram rejected the bot token")
    expect(request).toHaveBeenCalledTimes(1)
  })
})
