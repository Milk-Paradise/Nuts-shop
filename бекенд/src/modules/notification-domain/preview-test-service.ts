import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { NOTIFICATION_TEMPLATE_EXAMPLE } from "../../lib/cms-content"
import { NOTIFICATION_DOMAIN_MODULE } from "."
import type NotificationDomainModuleService from "./service"
import type { NotificationChannelSettingRecord } from "./channel-settings"
import {
  getNotificationDeliveryAdapter,
  type DeliveryChannel,
} from "./delivery-adapter-registry"
import {
  calendarDateInTimezone,
  DEFAULT_SMS_DAILY_LIMIT,
  NotificationDeliveryExecutor,
  SMS_DAILY_LIMIT_REASON,
} from "./delivery-executor"
import { loadOrderNotificationData } from "./order-data"
import { renderNotification } from "./renderer"

export type PreviewTestInput = {
  event: string
  channel: DeliveryChannel
  subject?: string | null
  text: string
  order_id?: string
  use_example?: boolean
  send_test?: boolean
  phone?: string
}

type PreviewTestService = NotificationDomainModuleService

export const TEST_CHANNEL_UNAVAILABLE_REASON = "канал не настроен"
export const TEST_SMS_LIMIT_REASON = SMS_DAILY_LIMIT_REASON

export function smsPartCount(text: string) {
  return text.length <= 70 ? 1 : Math.ceil(text.length / 67)
}

export function normalizeRussianPhone(value: string | undefined) {
  if (!value) return null
  const digits = value.replace(/\D/g, "")
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`
  }
  if (digits.length === 10 && digits.startsWith("9")) return `+7${digits}`
  return null
}

function configuredRecipient(
  channel: DeliveryChannel,
  setting: NotificationChannelSettingRecord,
  credentials: Record<string, unknown> | null,
  phone: string | undefined
) {
  if (channel === "sms") return normalizeRussianPhone(phone)
  // Контракт каналов продавца (AIL-176/177/178): адрес продавца в канале — configuration.seller_recipient
  // (почта продавца; chat id Telegram продавца после его привязки).
  const configured = setting.configuration?.seller_recipient
  if (typeof configured === "string" && configured.trim()) return configured.trim()
  if (channel === "email" && typeof credentials?.from === "string") return credentials.from
  return null
}

async function latestUsableSetting(
  service: PreviewTestService,
  channel: DeliveryChannel
) {
  const [setting] = (await service.listNotificationChannelSettings(
    { channel },
    { order: { version: "DESC" }, take: 1 }
  )) as NotificationChannelSettingRecord[]
  return setting?.enabled && setting.verified_at && !setting.revoked_at
    ? setting
    : null
}

async function recordRejectedTest(
  service: PreviewTestService,
  input: PreviewTestInput,
  recipient: string,
  content: Record<string, unknown>,
  reason: string
) {
  const { notification } = await service.createNotificationOnce({
    event_key: `test:${input.event}:${randomUUID()}`,
    type: input.event,
    recipient,
    channel: input.channel,
    reason,
    text_origin: "template",
    is_test: true,
    content,
  })
  await service.transitionNotification(
    notification.id,
    "processing",
    "permanently_rejected",
    reason
  )
  return notification.id
}

export async function previewAndTestNotification(
  container: Pick<MedusaContainer, "resolve">,
  input: PreviewTestInput,
  now = new Date()
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as Parameters<
    typeof loadOrderNotificationData
  >[0]
  const variables = input.order_id
    ? await loadOrderNotificationData(query, input.order_id)
    : NOTIFICATION_TEMPLATE_EXAMPLE
  const rendered = renderNotification(
    { subject: input.subject, text: input.text },
    variables
  )
  const preview = {
    subject: rendered.subject,
    text: rendered.text,
    ...(input.channel === "sms" ? { sms_parts: smsPartCount(rendered.text) } : {}),
  }
  if (!input.send_test) return { preview }

  const service = container.resolve(NOTIFICATION_DOMAIN_MODULE) as PreviewTestService
  const setting = await latestUsableSetting(service, input.channel)
  const credentials = setting
    ? await service.retrieveRuntimeChannelCredentials(setting.id)
    : null
  const recipient = setting
    ? configuredRecipient(input.channel, setting, credentials, input.phone)
    : null
  const adapter = getNotificationDeliveryAdapter(input.channel)
  const content = { subject: rendered.subject, text: rendered.text, html: rendered.html }

  if (!setting || !recipient || !adapter) {
    const notificationId = await recordRejectedTest(
      service,
      input,
      recipient ?? input.phone ?? "unconfigured",
      content,
      TEST_CHANNEL_UNAVAILABLE_REASON
    )
    return {
      preview,
      test: { sent: false, reason: TEST_CHANNEL_UNAVAILABLE_REASON, notification_id: notificationId },
    }
  }

  if (input.channel === "sms") {
    const timezone = process.env.STORE_TIMEZONE || "Europe/Moscow"
    const reserved = await service.reserveSmsDailyLimit(
      calendarDateInTimezone(now, timezone),
      timezone,
      setting.daily_limit ?? DEFAULT_SMS_DAILY_LIMIT
    )
    if (!reserved) {
      const notificationId = await recordRejectedTest(
        service,
        input,
        recipient,
        content,
        TEST_SMS_LIMIT_REASON
      )
      return {
        preview,
        test: { sent: false, reason: TEST_SMS_LIMIT_REASON, notification_id: notificationId },
      }
    }
  }

  const { notification } = await service.createNotificationOnce({
    event_key: `test:${input.event}:${randomUUID()}`,
    type: input.event,
    recipient,
    channel: input.channel,
    template_key: input.event,
    text_origin: "template",
    is_test: true,
    content,
  })
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const executor = new NotificationDeliveryExecutor(service, logger, () => now)
  const outcome = await executor.execute(notification.id, adapter)
  if (outcome.status === "retry_pending") {
    await service.transitionNotification(
      notification.id,
      "retry_pending",
      "retries_exhausted",
      "test delivery is not retried",
      null
    )
  }
  return {
    preview,
    test: {
      sent: outcome.status === "completed",
      reason: outcome.status === "completed" ? null : outcome.status,
      notification_id: notification.id,
    },
  }
}
