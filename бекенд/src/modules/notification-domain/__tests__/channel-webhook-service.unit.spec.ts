import NotificationDomainModuleService from "../service"
import type { TelegramWebhookStatus } from "../channel-settings"

jest.mock("../credentials", () => ({
  encryptNotificationCredentials: jest.fn(() => "encrypted"),
  decryptNotificationCredentials: jest.fn(),
}))

describe("channel webhook persistence", () => {
  it.each<TelegramWebhookStatus["status"]>(["missing", "foreign", "ok", "unknown"])(
    "persists %s and allows enabling the channel", async (status) => {
      const service = Object.create(NotificationDomainModuleService.prototype) as NotificationDomainModuleService
      const context = { manager: { test: true } as never, transactionManager: { test: true } as never }
      const webhook: TelegramWebhookStatus = {
        status,
        expected_url: "https://backend.test/hooks/telegram",
        checked_at: new Date().toISOString(),
        ...(status === "foreign" ? { url: "https://other.test/hook" } : {}),
      }
      let current = {
        id: "previous", version: 1, enabled: false,
        configuration: { seller_recipient: "123", webhook: { status: "ok" } },
      }
      jest.spyOn(service, "listNotificationChannelSettings").mockImplementation(async () => [current] as never)
      const create = jest.spyOn(service, "createNotificationChannelSettings").mockImplementation(async (input) => {
        current = { ...input, id: "new" } as unknown as typeof current
        return current as never
      })
      jest.spyOn(service, "updateNotificationChannelSettings").mockImplementation(async (input) => {
        current = { ...current, ...input } as unknown as typeof current
        return current as never
      })
      const saved = await service.replaceChannelCredentials({
        channel: "telegram", credentials: { bot_token: "token", bot_username: "shop_bot" }, webhook,
      }, context)
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        configuration: { seller_recipient: "123", bot_username: "shop_bot", webhook },
      }), expect.anything())
      expect(saved.configuration.webhook).toEqual(webhook)
      await expect(service.setChannelEnabled("telegram", true, context)).resolves.toMatchObject({
        enabled: true, configuration: { webhook },
      })
    }
  )
})
