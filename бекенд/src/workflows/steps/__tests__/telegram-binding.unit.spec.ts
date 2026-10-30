import { createHash } from "node:crypto"

import {
  TELEGRAM_BINDING_TTL_MS,
  issueTelegramBinding,
  processTelegramWebhook,
} from "../telegram-binding"

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function fixture(options: { enabled?: boolean } = {}) {
  const binding = {
    token_hash: hash("one-time-token"),
    expires_at: new Date("2026-10-08T12:15:00.000Z"),
    used_at: null as Date | null,
    chat_id: null as string | null,
  }
  const service = {
    listNotificationChannelSettings: jest.fn().mockResolvedValue([
      {
        id: "telegram-v1",
        enabled: options.enabled ?? true,
        revoked_at: null,
        encrypted_credentials: "encrypted",
      },
    ]),
    retrieveRuntimeChannelCredentials: jest.fn().mockResolvedValue({
      bot_token: "bot-token",
      bot_username: "catalog_test_bot",
      webhook_secret: "webhook-secret",
    }),
    issueTelegramBindingToken: jest.fn(),
    consumeTelegramBindingToken: jest.fn(
      async (tokenHash: string, chatId: string, now: Date) => {
        if (tokenHash !== binding.token_hash) {
          return { status: "rejected", reason: "invalid_token" }
        }
        if (binding.used_at) {
          return { status: "rejected", reason: "token_already_used" }
        }
        if (binding.expires_at.getTime() <= now.getTime()) {
          return { status: "rejected", reason: "token_expired" }
        }
        binding.used_at = now
        binding.chat_id = chatId
        return { status: "linked", account_id: "customer_1" }
      }
    ),
  }
  const locking = {
    execute: jest.fn(async (_key, callback) => callback()),
  }
  const container = {
    resolve: jest.fn((key: string) =>
      key === "notificationDomain" ? service : locking
    ),
  }

  return { binding, container, locking, service }
}

describe("Telegram binding", () => {
  it("does not read the supplied secret while the channel is unconfigured", async () => {
    const { container, service } = fixture()
    service.retrieveRuntimeChannelCredentials.mockResolvedValue({})
    const previousUsername = process.env.TELEGRAM_BOT_USERNAME
    const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET
    delete process.env.TELEGRAM_BOT_USERNAME
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    const readSecret = jest.fn(() => "wrong-secret")
    try {
      await expect(processTelegramWebhook(container as never, {
        get secret() { return readSecret() },
        update: {},
      })).resolves.toEqual({ status: "unavailable", reason: "channel_not_configured" })
      expect(readSecret).not.toHaveBeenCalled()
      expect(service.consumeTelegramBindingToken).not.toHaveBeenCalled()
      await expect(issueTelegramBinding(container as never, { account_id: "customer_1" }))
        .rejects.toMatchObject({ type: "unexpected_state", message: "Telegram channel requires bot_username and webhook_secret" })
    } finally {
      if (previousUsername === undefined) delete process.env.TELEGRAM_BOT_USERNAME
      else process.env.TELEGRAM_BOT_USERNAME = previousUsername
      if (previousSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET
      else process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret
    }
  })

  it("does not issue a link while the Telegram channel is disabled", async () => {
    const { container, service } = fixture({ enabled: false })

    await expect(
      issueTelegramBinding(
        container as never,
        { account_id: "customer_1" },
        new Date("2026-10-08T12:00:00.000Z"),
        () => "one-time-token"
      )
    ).rejects.toThrow("Telegram notification channel is disabled")
    expect(service.issueTelegramBindingToken).not.toHaveBeenCalled()
  })

  it("issues a 15-minute one-time link without storing the open token", async () => {
    const { container, service } = fixture()
    const now = new Date("2026-10-08T12:00:00.000Z")

    await expect(
      issueTelegramBinding(
        container as never,
        { account_id: "customer_1" },
        now,
        () => "one-time-token"
      )
    ).resolves.toEqual({
      url: "https://t.me/catalog_test_bot?start=one-time-token",
      expires_at: new Date(now.getTime() + TELEGRAM_BINDING_TTL_MS),
    })
    expect(service.issueTelegramBindingToken).toHaveBeenCalledWith(
      "customer_1",
      hash("one-time-token"),
      new Date("2026-10-08T12:15:00.000Z")
    )
    expect(service.issueTelegramBindingToken).not.toHaveBeenCalledWith(
      expect.anything(),
      "one-time-token",
      expect.anything()
    )
  })

  it("rejects an expired token with a retryable reason", async () => {
    const { container, binding } = fixture()

    await expect(
      processTelegramWebhook(
        container as never,
        {
          secret: "webhook-secret",
          update: { message: { text: "/start one-time-token", chat: { id: 42 } } },
        },
        new Date("2026-10-08T12:15:00.000Z")
      )
    ).resolves.toEqual({ status: "rejected", reason: "token_expired" })
    expect(binding.chat_id).toBeNull()
  })

  it("does not rebind when the same /start token is used twice", async () => {
    const { binding, container } = fixture()
    const now = new Date("2026-10-08T12:10:00.000Z")

    await expect(
      processTelegramWebhook(
        container as never,
        {
          secret: "webhook-secret",
          update: { message: { text: "/start one-time-token", chat: { id: 42 } } },
        },
        now
      )
    ).resolves.toMatchObject({ status: "linked" })
    await expect(
      processTelegramWebhook(
        container as never,
        {
          secret: "webhook-secret",
          update: { message: { text: "/start one-time-token", chat: { id: 99 } } },
        },
        now
      )
    ).resolves.toEqual({ status: "rejected", reason: "token_already_used" })
    expect(binding.chat_id).toBe("42")
  })

  it("passes the Telegram username and display name when binding succeeds", async () => {
    const { container, service } = fixture()

    await processTelegramWebhook(container as never, {
      secret: "webhook-secret",
      update: {
        message: {
          text: "/start one-time-token",
          chat: { id: 42 },
          from: {
            username: "catalog_customer",
            first_name: "Иван",
            last_name: "Петров",
          },
        },
      },
    })

    expect(service.consumeTelegramBindingToken).toHaveBeenCalledWith(
      hash("one-time-token"),
      "42",
      expect.any(Date),
      "catalog_customer",
      "Иван Петров"
    )
  })

  it("passes a null username and the available display name", async () => {
    const { container, service } = fixture()

    await processTelegramWebhook(container as never, {
      secret: "webhook-secret",
      update: {
        message: {
          text: "/start one-time-token",
          chat: { id: 42 },
          from: { first_name: "Иван" },
        },
      },
    })

    expect(service.consumeTelegramBindingToken).toHaveBeenCalledWith(
      hash("one-time-token"),
      "42",
      expect.any(Date),
      null,
      "Иван"
    )
  })

  it.each([undefined, "wrong-secret"])(
    "rejects a webhook with missing or wrong secret (%s) before consuming a token",
    async (secret) => {
    const { container, service } = fixture()

    await expect(
      processTelegramWebhook(container as never, {
        secret,
        update: { message: { text: "/start one-time-token", chat: { id: 42 } } },
      })
    ).rejects.toThrow("Invalid Telegram webhook secret")
    expect(service.consumeTelegramBindingToken).not.toHaveBeenCalled()
    }
  )
})
