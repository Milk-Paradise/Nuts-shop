const mockSendMail = jest.fn()
const mockCreateTransport = jest.fn((_options: unknown) => ({ sendMail: mockSendMail }))

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: (options: unknown) => mockCreateTransport(options) },
}))

import SmtpNotificationService, {
  createEmailDeliveryAdapter,
} from "../service"

const deliveryNotification = {
  id: "notification_1",
  type: "order-confirmation",
  recipient: "customer@example.com",
  channel: "email" as const,
  state: "processing" as const,
  content: {
    subject: "Заказ принят",
    text: "Спасибо за заказ",
    html: "<p>Спасибо за заказ</p>",
  },
  created_at: new Date("2026-10-08T10:00:00.000Z"),
}

function buildDeliveryAdapter(send = jest.fn(), settings?: unknown[]) {
  const currentSetting = {
    id: "email-v3",
    channel: "email" as const,
    version: 3,
    enabled: true,
    encrypted_credentials: "encrypted",
    configuration: {},
    daily_limit: null,
    verified_at: new Date(),
    revoked_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  }
  const retrieveRuntimeChannelCredentials = jest
    .fn()
    .mockResolvedValue({ from: "orders@example.com" })
  const adapter = createEmailDeliveryAdapter({
    provider: { send },
    listChannelSettings: jest.fn().mockResolvedValue(settings ?? [currentSetting]),
    retrieveRuntimeChannelCredentials,
    readCompanyName: jest.fn().mockResolvedValue('ООО "Автокраска"'),
    defaultFrom: "legacy@example.com",
    classifyErrors: true,
  })
  return { adapter, send, retrieveRuntimeChannelCredentials }
}

function buildService(options: Partial<Record<string, unknown>> = {}) {
  const logger = { error: jest.fn(), info: jest.fn() }
  const service = new (SmtpNotificationService as any)(
    { logger },
    {
      host: "smtp.example.com",
      port: 587,
      user: "user",
      password: "pass",
      from: "no-reply@example.com",
      ...options,
    }
  )

  return { service, logger }
}

describe("SmtpNotificationService", () => {
  beforeEach(() => {
    mockSendMail.mockReset()
    mockCreateTransport.mockClear()
  })

  it("configures the transporter from the provider options", () => {
    buildService()

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 587,
        auth: { user: "user", pass: "pass" },
      })
    )
  })

  it("omits auth when no user is configured", () => {
    buildService({ user: undefined, password: undefined })

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined })
    )
  })

  it("sends the notification content through the transporter", async () => {
    const { service } = buildService()
    mockSendMail.mockResolvedValue({ messageId: "msg_1" })

    const result = await service.send({
      to: "customer@example.com",
      channel: "email",
      template: "reset-password",
      content: { subject: "Reset your password", text: "text", html: "<p>html</p>" },
    })

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        from: "no-reply@example.com",
        subject: "Reset your password",
        text: "text",
        html: "<p>html</p>",
      })
    )
    expect(result).toEqual({ id: "msg_1" })
  })

  it("uses the notification's own from address when provided", async () => {
    const { service } = buildService()
    mockSendMail.mockResolvedValue({ messageId: "msg_2" })

    await service.send({
      to: "customer@example.com",
      from: "orders@example.com",
      channel: "email",
      template: "order-placed",
    })

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "orders@example.com" })
    )
  })

  it("throws a safe error without a duplicate provider log when sending fails", async () => {
    const { service, logger } = buildService()
    mockSendMail.mockRejectedValue(new Error("connection refused"))

    await expect(
      service.send({
        to: "customer@example.com",
        channel: "email",
        template: "reset-password",
      })
    ).rejects.toThrow("SMTP notification delivery failed")
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("does not log a non-Error rejection and still throws a safe error", async () => {
    const { service, logger } = buildService()
    mockSendMail.mockRejectedValue("ECONNREFUSED")

    await expect(
      service.send({
        to: "customer@example.com",
        channel: "email",
        template: "reset-password",
      })
    ).rejects.toThrow("SMTP notification delivery failed")
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("preserves only safe SMTP classification fields on the provider error", async () => {
    const { service } = buildService()
    mockSendMail.mockRejectedValue(
      Object.assign(new Error("recipient details"), {
        code: "EENVELOPE",
        command: "RCPT TO",
        responseCode: 550,
      })
    )

    await expect(
      service.send({
        to: "customer@example.com",
        channel: "email",
        template: "reset-password",
      })
    ).rejects.toMatchObject({
      message: "SMTP notification delivery failed",
      smtpCode: "EENVELOPE",
      smtpCommand: "RCPT TO",
      smtpResponseCode: 550,
    })
  })

  it("throws when no notification is provided", async () => {
    const { service } = buildService()

    await expect(service.send(undefined as never)).rejects.toThrow(
      "No notification information provided"
    )
  })
})

describe("SMTP common-result delivery adapter", () => {
  it("saves the SMTP messageId and uses the pinned channel version and company name", async () => {
    const send = jest.fn().mockResolvedValue({ id: "smtp-message-42" })
    const { adapter, retrieveRuntimeChannelCredentials } = buildDeliveryAdapter(send)

    const result = await adapter.deliver({
      notification: deliveryNotification,
      attempt_number: 1,
      external_id: "notification_1:1",
    })

    expect(retrieveRuntimeChannelCredentials).toHaveBeenCalledWith("email-v3")
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"ООО \\"Автокраска\\"" <orders@example.com>',
        to: "customer@example.com",
      })
    )
    expect(result).toEqual({
      classification: "success",
      external_id: "smtp-message-42",
      channel_setting_version_id: "email-v3",
    })
  })

  it.each([null, {}, { from: "" }])("uses the environment sender when saved credentials have no from (%j)", async (credentials) => {
    const send = jest.fn().mockResolvedValue({ id: "smtp-fallback" })
    const { adapter, retrieveRuntimeChannelCredentials } = buildDeliveryAdapter(send)
    retrieveRuntimeChannelCredentials.mockResolvedValue(credentials)

    const result = await adapter.deliver({
      notification: deliveryNotification,
      attempt_number: 1,
      external_id: "notification_1:1",
    })

    expect(result.classification).toBe("success")
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining("<legacy@example.com>") })
    )
  })

  it("sends with the environment sender when no email channel setting is saved", async () => {
    const send = jest.fn().mockResolvedValue({ id: "smtp-message-7" })
    const { adapter, retrieveRuntimeChannelCredentials } = buildDeliveryAdapter(send, [])

    const result = await adapter.deliver({
      notification: deliveryNotification,
      attempt_number: 1,
      external_id: "notification_1:1",
    })

    expect(retrieveRuntimeChannelCredentials).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining("legacy@example.com") })
    )
    expect(result).toEqual({
      classification: "success",
      external_id: "smtp-message-7",
      channel_setting_version_id: null,
    })
  })

  it("classifies an address rejected during RCPT TO as a permanent failure", async () => {
    const rejection = Object.assign(new Error("mailbox unavailable"), {
      code: "EENVELOPE",
      command: "RCPT TO",
      responseCode: 550,
    })
    const { adapter } = buildDeliveryAdapter(
      jest.fn().mockRejectedValue(rejection)
    )

    await expect(
      adapter.deliver({
        notification: deliveryNotification,
        attempt_number: 1,
        external_id: "notification_1:1",
      })
    ).resolves.toMatchObject({
      classification: "permanent_failure",
      channel_setting_version_id: "email-v3",
      safe_diagnostics: { code: "EENVELOPE", response_code: 550 },
    })
  })

  it("classifies a broken SMTP connection as a temporary failure", async () => {
    const connectionError = Object.assign(new Error("socket closed"), {
      code: "ECONNRESET",
      command: "CONN",
    })
    const { adapter } = buildDeliveryAdapter(
      jest.fn().mockRejectedValue(connectionError)
    )

    await expect(
      adapter.deliver({
        notification: deliveryNotification,
        attempt_number: 1,
        external_id: "notification_1:1",
      })
    ).resolves.toMatchObject({
      classification: "temporary_failure",
      channel_setting_version_id: "email-v3",
      safe_diagnostics: { code: "ECONNRESET" },
    })
  })

  it("keeps the selected version when reading its credentials fails", async () => {
    const { adapter, retrieveRuntimeChannelCredentials } = buildDeliveryAdapter()
    retrieveRuntimeChannelCredentials.mockRejectedValue(
      new Error("credentials unavailable")
    )

    await expect(
      adapter.deliver({
        notification: deliveryNotification,
        attempt_number: 1,
        external_id: "notification_1:1",
      })
    ).resolves.toMatchObject({
      classification: "temporary_failure",
      channel_setting_version_id: "email-v3",
      safe_diagnostics: { error_name: "Error" },
    })
  })
})
