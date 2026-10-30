import { MedusaError } from "@medusajs/framework/utils"

import type {
  NotificationChannel,
  NotificationChannelCredentials,
  TelegramWebhookStatus,
} from "./channel-settings"

export class NotificationChannelVerificationError extends MedusaError {
  constructor(message: string) {
    super(MedusaError.Types.INVALID_DATA, message)
  }
}

type Fetch = typeof fetch

function verificationFailure(channel: NotificationChannel, reason: string) {
  return new NotificationChannelVerificationError(
    `Could not verify ${channel} channel: ${reason}`
  )
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

export class NotificationChannelVerifier {
  constructor(private readonly request: Fetch = fetch) {}

  private async checkTelegramWebhook(botToken: string): Promise<TelegramWebhookStatus> {
    const backendUrl = process.env.MEDUSA_BACKEND_URL?.trim().replace(/\/+$/, "")
    const result: TelegramWebhookStatus = {
      status: "unknown",
      expected_url: backendUrl ? `${backendUrl}/hooks/telegram` : "",
      checked_at: new Date().toISOString(),
    }
    // Without a backend URL there is no trusted address to compare against.
    if (!backendUrl) return result
    try {
      const response = await this.request(
        `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getWebhookInfo`,
        { signal: AbortSignal.timeout(10_000) }
      )
      const payload = await readJson(response)
      const webhook = payload.result as { url?: unknown } | null
      if (!response.ok || payload.ok !== true || typeof webhook?.url !== "string") {
        return result
      }
      if (!webhook.url) return { ...result, status: "missing" }
      if (webhook.url === result.expected_url) return { ...result, status: "ok" }
      return { ...result, status: "foreign", url: webhook.url }
    } catch {
      return result
    }
  }

  async verify(
    channel: NotificationChannel,
    credentials: NotificationChannelCredentials[NotificationChannel]
  ) {
    try {
      if (channel === "email") {
        const from = (credentials as NotificationChannelCredentials["email"]).from
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
          throw verificationFailure(channel, "sender address is invalid")
        }
        return
      }

      if (channel === "telegram") {
        const { bot_token } =
          credentials as NotificationChannelCredentials["telegram"]
        const response = await this.request(
          `https://api.telegram.org/bot${encodeURIComponent(bot_token)}/getMe`,
          { signal: AbortSignal.timeout(10_000) }
        )
        const payload = await readJson(response)
        if (!response.ok || payload.ok !== true) {
          throw verificationFailure(channel, "Telegram rejected the bot token")
        }
        return { webhook: await this.checkTelegramWebhook(bot_token) }
      }

      const { login, password } =
        credentials as NotificationChannelCredentials["sms"]
      const response = await this.request("https://smsc.ru/sys/balance.php", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ login, psw: password, fmt: "3" }),
        signal: AbortSignal.timeout(10_000),
      })
      const payload = await readJson(response)
      if (!response.ok || typeof payload.balance !== "string") {
        throw verificationFailure(channel, "SMSC.ru rejected the credentials")
      }
    } catch (error) {
      if (error instanceof NotificationChannelVerificationError) throw error
      throw verificationFailure(
        channel,
        error instanceof Error ? error.message : "verification request failed"
      )
    }
  }
}
