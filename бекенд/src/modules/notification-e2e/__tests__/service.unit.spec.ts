const originalNodeEnv = process.env.NODE_ENV
const originalE2ERun = process.env.E2E_RUN
const originalFetch = global.fetch
const mockFetch = jest.fn()

import E2ENotificationService from "../service"

function buildService() {
  const logger = { error: jest.fn(), info: jest.fn() }
  const service = new (E2ENotificationService as any)(
    { logger },
    { base_url: "http://127.0.0.1:12345/" }
  )

  return { service, logger }
}

describe("E2ENotificationService", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test"
    global.fetch = mockFetch
  })

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv

    if (originalE2ERun === undefined) delete process.env.E2E_RUN
    else process.env.E2E_RUN = originalE2ERun

    global.fetch = originalFetch
  })

  beforeEach(() => mockFetch.mockReset())

  it("is unavailable outside test and e2e modes", () => {
    process.env.NODE_ENV = "production"
    process.env.E2E_RUN = "false"

    expect(() => buildService()).toThrow("available only in test/e2e runs")

    process.env.NODE_ENV = "test"
  })

  it("forwards the complete notification to the interception stub", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "notification_1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    )
    const { service } = buildService()
    const notification = {
      to: "customer@example.test",
      channel: "email",
      template: "customer-password-reset",
      data: { token: "reset-token" },
    }

    await expect(service.send(notification)).resolves.toEqual({
      id: "notification_1",
    })
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:12345/notifications",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(notification),
      })
    )
  })

  it("fails visibly when interception is unavailable", async () => {
    mockFetch.mockResolvedValue(new Response("down", { status: 503 }))
    const { service, logger } = buildService()

    await expect(
      service.send({ to: "customer@example.test", channel: "email" })
    ).rejects.toThrow("HTTP 503")
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("HTTP 503")
    )
  })
})
