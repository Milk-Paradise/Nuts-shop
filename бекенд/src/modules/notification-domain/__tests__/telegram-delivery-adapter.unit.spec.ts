import { TelegramDeliveryAdapter } from "../telegram-delivery-adapter"

const notification = {
  id: "notification_telegram_1",
  type: "order-confirmation",
  recipient: "123456",
  channel: "telegram" as const,
  state: "processing" as const,
  content: { body: "Заказ принят" },
  created_at: new Date("2026-10-08T12:00:00.000Z"),
}

function buildService() {
  return {
    listNotificationChannelSettings: jest.fn().mockResolvedValue([
      {
        id: "setting_v3",
        enabled: true,
        revoked_at: null,
      },
    ]),
    retrieveRuntimeChannelCredentials: jest
      .fn()
      .mockResolvedValue({ bot_token: "secret-token" }),
    disableTelegramBindingByChatId: jest.fn().mockResolvedValue({
      connected: false,
      state: "disabled",
    }),
  }
}

describe("TelegramDeliveryAdapter", () => {
  it("pins the current credential version and sends to the notification chat id", async () => {
    const service = buildService()
    const client = {
      sendMessage: jest.fn().mockResolvedValue({
        status: 200,
        payload: { ok: true, result: { message_id: 42 } },
      }),
    }
    const adapter = new TelegramDeliveryAdapter(service as never, client as never)

    await expect(
      adapter.deliver({
        notification,
        attempt_number: 1,
        external_id: "notification_telegram_1:1",
      })
    ).resolves.toEqual({
      classification: "success",
      external_id: "42",
      channel_setting_version_id: "setting_v3",
    })
    expect(service.retrieveRuntimeChannelCredentials).toHaveBeenCalledWith(
      "setting_v3"
    )
    expect(client.sendMessage).toHaveBeenCalledWith(
      "secret-token",
      "123456",
      "Заказ принят"
    )
  })

  it("disables the binding and rejects delivery when Telegram returns 403", async () => {
    const service = buildService()
    const client = {
      sendMessage: jest.fn().mockResolvedValue({
        status: 403,
        payload: { ok: false, error_code: 403 },
      }),
    }
    const adapter = new TelegramDeliveryAdapter(service as never, client as never)

    await expect(
      adapter.deliver({
        notification,
        attempt_number: 1,
        external_id: "notification_telegram_1:1",
      })
    ).resolves.toMatchObject({
      classification: "permanent_failure",
      reason: "покупатель отключил канал",
      channel_setting_version_id: "setting_v3",
    })
    expect(service.disableTelegramBindingByChatId).toHaveBeenCalledWith("123456")
  })

  it("returns an unknown outcome when the Telegram request times out", async () => {
    const service = buildService()
    const timeout = new Error("request timed out")
    timeout.name = "TimeoutError"
    const client = { sendMessage: jest.fn().mockRejectedValue(timeout) }
    const adapter = new TelegramDeliveryAdapter(service as never, client as never)

    await expect(
      adapter.deliver({
        notification,
        attempt_number: 1,
        external_id: "notification_telegram_1:1",
      })
    ).resolves.toEqual({
      classification: "unknown",
      channel_setting_version_id: "setting_v3",
      safe_diagnostics: { error_name: "TimeoutError" },
    })
  })

  it("returns a temporary failure when the connection to Telegram is not established", async () => {
    const service = buildService()
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    })
    const client = { sendMessage: jest.fn().mockRejectedValue(refused) }
    const adapter = new TelegramDeliveryAdapter(service as never, client as never)

    await expect(
      adapter.deliver({
        notification,
        attempt_number: 1,
        external_id: "notification_telegram_1:1",
      })
    ).resolves.toEqual({
      classification: "temporary_failure",
      channel_setting_version_id: "setting_v3",
      safe_diagnostics: { error_name: "TypeError", error_code: "ECONNREFUSED" },
    })
  })
})
