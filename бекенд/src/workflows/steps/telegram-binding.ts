import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  NOTIFICATION_DOMAIN_MODULE,
} from "../../modules/notification-domain"
import type NotificationDomainModuleService from "../../modules/notification-domain/service"
import type {
  NotificationChannelSettingRecord,
  NotificationChannelCredentials,
} from "../../modules/notification-domain/channel-settings"

export const TELEGRAM_BINDING_TTL_MS = 15 * 60 * 1000
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token"

type TelegramUpdate = {
  message?: {
    text?: unknown
    chat?: { id?: unknown }
    from?: {
      username?: unknown
      first_name?: unknown
      last_name?: unknown
    }
  }
}

type TelegramRuntime = {
  botUsername: string
  webhookSecret: string
  enabled: boolean
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function telegramRuntime(service: NotificationDomainModuleService): Promise<TelegramRuntime>
function telegramRuntime(service: NotificationDomainModuleService, requireEnabled: false): Promise<TelegramRuntime | null>
async function telegramRuntime(
  service: NotificationDomainModuleService,
  requireEnabled = true
): Promise<TelegramRuntime | null> {
  const [setting] = (await service.listNotificationChannelSettings(
    { channel: "telegram" },
    { order: { version: "DESC" }, take: 1 }
  )) as NotificationChannelSettingRecord[]

  const enabled = Boolean(setting?.enabled && !setting.revoked_at)
  if (requireEnabled && !enabled) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Telegram notification channel is disabled"
    )
  }

  const credentials = setting?.encrypted_credentials
    ? ((await service.retrieveRuntimeChannelCredentials(
        setting.id
      )) as NotificationChannelCredentials["telegram"])
    : null
  const botUsername = credentials?.bot_username ?? process.env.TELEGRAM_BOT_USERNAME
  const webhookSecret =
    credentials?.webhook_secret ?? process.env.TELEGRAM_WEBHOOK_SECRET

  if (!botUsername || !webhookSecret) {
    if (!requireEnabled) return null
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Telegram channel requires bot_username and webhook_secret"
    )
  }
  return {
    botUsername: botUsername.replace(/^@/, ""),
    webhookSecret,
    enabled,
  }
}

export type IssueTelegramBindingInput = { account_id: string }

export async function issueTelegramBinding(
  container: Pick<MedusaContainer, "resolve">,
  input: IssueTelegramBindingInput,
  now = new Date(),
  createToken: () => string = () => randomBytes(32).toString("base64url")
) {
  const service = container.resolve<NotificationDomainModuleService>(
    NOTIFICATION_DOMAIN_MODULE
  )
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  return locking.execute(`telegram-binding-account:${input.account_id}`, async () => {
    const runtime = await telegramRuntime(service)
    const token = createToken()
    const expiresAt = new Date(now.getTime() + TELEGRAM_BINDING_TTL_MS)
    await service.issueTelegramBindingToken(
      input.account_id,
      tokenHash(token),
      expiresAt
    )

    return {
      url: `https://t.me/${runtime.botUsername}?start=${token}`,
      expires_at: expiresAt,
    }
  }, { timeout: 15 })
}

export const issueTelegramBindingStep = createStep(
  "issue-telegram-binding",
  async (input: IssueTelegramBindingInput, { container }) =>
    new StepResponse(await issueTelegramBinding(container, input))
)

export type DisableTelegramBindingInput = { account_id: string }

export const disableTelegramBindingStep = createStep(
  "disable-telegram-binding",
  async (input: DisableTelegramBindingInput, { container }) => {
    const service = container.resolve<NotificationDomainModuleService>(
      NOTIFICATION_DOMAIN_MODULE
    )
    return new StepResponse(
      await service.disableTelegramBinding(input.account_id)
    )
  }
)

export type ProcessTelegramWebhookInput = {
  secret: string | undefined
  update: unknown
}

export async function processTelegramWebhook(
  container: Pick<MedusaContainer, "resolve">,
  input: ProcessTelegramWebhookInput,
  now = new Date()
) {
  const service = container.resolve<NotificationDomainModuleService>(
    NOTIFICATION_DOMAIN_MODULE
  )
  const runtime = await telegramRuntime(service, false)
  if (!runtime) {
    return { status: "unavailable" as const, reason: "channel_not_configured" }
  }
  if (!input.secret || !safeEqual(input.secret, runtime.webhookSecret)) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Invalid Telegram webhook secret"
    )
  }
  if (!runtime.enabled) {
    return { status: "rejected" as const, reason: "channel_disabled" }
  }

  const update = input.update as TelegramUpdate | null
  const text = update?.message?.text
  const chatId = update?.message?.chat?.id
  if (typeof text !== "string" || (typeof chatId !== "string" && typeof chatId !== "number")) {
    return { status: "ignored" as const, reason: "unsupported_update" }
  }
  const token = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]+)\s*$/)?.[1]
  if (!token) return { status: "ignored" as const, reason: "unsupported_command" }

  const from = update?.message?.from
  const username =
    typeof from?.username === "string"
      ? from.username.trim().replace(/^@/, "") || null
      : null
  const displayName = [from?.first_name, from?.last_name]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .map((part) => part.trim())
    .join(" ") || null

  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  return locking.execute(
    `telegram-binding-token:${tokenHash(token)}`,
    () => service.consumeTelegramBindingToken(
      tokenHash(token),
      String(chatId),
      now,
      username,
      displayName
    ),
    { timeout: 15 }
  )
}

export const processTelegramWebhookStep = createStep(
  "process-telegram-webhook",
  async (input: ProcessTelegramWebhookInput, { container }) => {
    try {
      return new StepResponse(await processTelegramWebhook(container, input))
    } catch (error) {
      container.resolve(ContainerRegistrationKeys.LOGGER).error(
        `Telegram binding webhook failed: ${error instanceof Error ? error.message : "unknown error"}`
      )
      throw error
    }
  }
)
