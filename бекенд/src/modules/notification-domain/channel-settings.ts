import { MedusaError } from "@medusajs/framework/utils"

export const NOTIFICATION_CHANNELS = ["email", "telegram", "sms"] as const

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export function parseNotificationChannel(value: string): NotificationChannel {
  if ((NOTIFICATION_CHANNELS as readonly string[]).includes(value)) {
    return value as NotificationChannel
  }
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `Unsupported notification channel: ${value}`
  )
}

export type NotificationChannelCredentials = {
  email: { from: string }
  telegram: {
    bot_token: string
    bot_username?: string
    webhook_secret?: string
  }
  sms: {
    login: string
    password: string
    sender?: string
    callback_secret?: string
  }
}

export type TelegramWebhookStatus = {
  status: "ok" | "missing" | "foreign" | "unknown"
  url?: string
  expected_url: string
  checked_at: string
}

export type ConfigureNotificationChannelInput = {
  channel: NotificationChannel
  credentials: NotificationChannelCredentials[NotificationChannel]
  daily_limit?: number
  webhook?: TelegramWebhookStatus
}

export type NotificationChannelSettingRecord = {
  id: string
  channel: NotificationChannel
  version: number
  enabled: boolean
  encrypted_credentials: string | null
  configuration: Record<string, unknown>
  daily_limit: number | null
  verified_at: Date | null
  revoked_at: Date | null
  created_at: Date
  updated_at: Date
}

export type NotificationChannelPublicConfiguration = {
  webhook?: TelegramWebhookStatus
  sender?: string
  sender_fallback?: string
  bot_username?: string
  seller_recipient?: string
}

export function publicNotificationChannelConfiguration(
  setting: NotificationChannelSettingRecord
): NotificationChannelPublicConfiguration {
  const configuration = setting.configuration ?? {}
  const webhook = configuration.webhook as Partial<TelegramWebhookStatus> | null
  return {
    ...(setting.channel === "email" && process.env.SMTP_FROM
      ? { sender_fallback: process.env.SMTP_FROM }
      : {}),
    ...(setting.channel === "telegram" && webhook &&
    ["ok", "missing", "foreign", "unknown"].includes(webhook.status ?? "") &&
    typeof webhook.expected_url === "string" && typeof webhook.checked_at === "string"
      ? { webhook: {
          status: webhook.status as TelegramWebhookStatus["status"],
          expected_url: webhook.expected_url,
          checked_at: webhook.checked_at,
          ...(webhook.status === "foreign" && typeof webhook.url === "string"
            ? { url: webhook.url } : {}),
        } }
      : {}),
    ...(typeof configuration.sender === "string"
      ? { sender: configuration.sender }
      : {}),
    ...(typeof configuration.bot_username === "string"
      ? { bot_username: configuration.bot_username }
      : {}),
    ...(typeof configuration.seller_recipient === "string"
      ? { seller_recipient: configuration.seller_recipient }
      : {}),
  }
}

export function serializeNotificationChannelSetting(
  setting: NotificationChannelSettingRecord
) {
  return {
    id: setting.id,
    channel: setting.channel,
    version: setting.version,
    enabled: setting.enabled,
    configured: Boolean(setting.encrypted_credentials),
    configuration: publicNotificationChannelConfiguration(setting),
    daily_limit: setting.daily_limit,
    verified_at: setting.verified_at,
    revoked_at: setting.revoked_at,
    created_at: setting.created_at,
    updated_at: setting.updated_at,
  }
}
