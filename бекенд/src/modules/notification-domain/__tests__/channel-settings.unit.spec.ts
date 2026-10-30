import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  parseNotificationChannel,
  publicNotificationChannelConfiguration,
  type NotificationChannelSettingRecord,
  serializeNotificationChannelSetting,
} from "../channel-settings"

describe("notification channel settings API", () => {
  beforeEach(() => {
    jest.replaceProperty(process, "env", { ...process.env, SMTP_FROM: "" })
  })

  afterEach(() => jest.restoreAllMocks())

  it("exposes only the SMTP sender fallback for email", () => {
    Object.assign(process.env, {
      SMTP_FROM: "server@example.test",
      SMTP_HOST: "private-host",
      SMTP_USER: "private-user",
      SMTP_PASSWORD: "private-password",
    })
    const setting = {
      channel: "email",
      configuration: {
        sender: "orders@example.test",
        SMTP_HOST: "private-host",
        SMTP_USER: "private-user",
        SMTP_PASSWORD: "private-password",
        sender_fallback: "stale@example.test",
      },
    } as unknown as NotificationChannelSettingRecord
    expect(serializeNotificationChannelSetting(setting).configuration).toEqual({
      sender: "orders@example.test",
      sender_fallback: "server@example.test",
    })
    expect(publicNotificationChannelConfiguration({ ...setting, configuration: {} })).toEqual({
      sender_fallback: "server@example.test",
    })
    for (const channel of ["telegram", "sms"] as const) {
      expect(publicNotificationChannelConfiguration({ ...setting, channel, configuration: {} })).toEqual({})
    }
  })

  it.each([undefined, ""])("omits an absent SMTP sender (%s)", (from) => {
    if (from === undefined) delete process.env.SMTP_FROM
    else process.env.SMTP_FROM = from
    expect(publicNotificationChannelConfiguration({
      channel: "email", configuration: {},
    } as NotificationChannelSettingRecord)).toEqual({})
  })

  it("never serializes encrypted or open credentials", () => {
    const response = serializeNotificationChannelSetting({
      id: "setting_1",
      channel: "telegram",
      version: 2,
      enabled: true,
      encrypted_credentials: "v2:secret-ciphertext",
      configuration: {
        bot_token: "must-not-leak",
        bot_username: "safe_bot",
        seller_recipient: "123456",
      },
      daily_limit: null,
      verified_at: new Date("2026-10-07T10:00:00Z"),
      revoked_at: null,
      created_at: new Date("2026-10-07T10:00:00Z"),
      updated_at: new Date("2026-10-07T10:00:00Z"),
    })

    expect(response).toMatchObject({ configured: true, version: 2 })
    expect(JSON.stringify(response)).not.toContain("secret")
    expect(JSON.stringify(response)).not.toContain("bot_token")
    expect(response.configuration).toEqual({
      bot_username: "safe_bot",
      seller_recipient: "123456",
    })
  })

  it.each(["missing", "foreign", "ok", "unknown"])("serializes only public webhook fields for %s", (status) => {
    const webhook = {
      status, url: "https://foreign.test/hook",
      expected_url: "https://backend.test/hooks/telegram",
      checked_at: "2026-10-10T10:00:00Z",
      bot_token: "private-token", webhook_secret: "private-secret",
    }
    const setting = { channel: "telegram", configuration: { webhook } } as unknown as NotificationChannelSettingRecord
    expect(publicNotificationChannelConfiguration(setting)).toEqual({ webhook: {
      status, expected_url: webhook.expected_url, checked_at: webhook.checked_at,
      ...(status === "foreign" ? { url: webhook.url } : {}),
    } })
    expect(publicNotificationChannelConfiguration({ ...setting, channel: "email" })).toEqual({})
    expect(publicNotificationChannelConfiguration({ ...setting, configuration: {} })).toEqual({})
  })

  it("rejects unsupported route parameters", () => {
    expect(() => parseNotificationChannel("push")).toThrow(
      "Unsupported notification channel"
    )
  })

  it("seeds a new store with only email enabled and an SMS limit of 100", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "src/modules/notification-domain/migrations/Migration20261007132421.ts"
      ),
      "utf8"
    )

    expect(migration).toContain("'email', 1, true")
    expect(migration).toContain("'telegram', 1, false")
    expect(migration).toContain("'sms', 1, false, '{}', 100")
  })
})
