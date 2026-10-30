import { maskNotificationSecrets } from "../../../lib/mask-notification-secrets"

type NotificationContent = {
  subject?: unknown
  text?: unknown
  body?: unknown
  order_id?: unknown
  display_id?: unknown
}

export type NotificationJournalRecord = {
  id: string
  event_key: string
  type: string
  recipient: string
  channel: string
  state: string
  reason: string | null
  template_key: string | null
  template_revision: string | null
  text_origin: string
  is_test: boolean
  content: unknown
  created_at: Date | string
}

export type NotificationAttemptRecord = {
  id: string
  notification_id: string
  attempt_number: number
  attempted_at: Date | string
  result: string
  safe_diagnostics: unknown
}

function contentOf(value: unknown): NotificationContent {
  return value && typeof value === "object" ? (value as NotificationContent) : {}
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null
}

export function orderIdFromNotification(record: NotificationJournalRecord) {
  const content = contentOf(record.content)
  const explicit = optionalString(content.order_id)
  if (explicit) return explicit

  const parts = record.event_key.split(":")
  return parts.find((part) => part.startsWith("order_")) ?? null
}

export function maskNotificationRecipient(recipient: string) {
  if (!recipient || recipient === "-") return "—"
  if (recipient.startsWith("@")) return recipient
  if (recipient.includes("@")) {
    const [local, domain] = recipient.split("@")
    return `${local.slice(0, 1)}•••@${domain}`
  }

  const digits = recipient.replace(/\D/g, "")
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7 ${digits.slice(1, 4)} •••-${digits.slice(-4, -2)}-${digits.slice(-2)}`
  }
  return recipient
}

function diagnosticReason(value: unknown) {
  if (!value || typeof value !== "object") return null
  const diagnostics = value as Record<string, unknown>
  return optionalString(diagnostics.reason) ?? optionalString(diagnostics.message)
}

export function serializeNotification(
  record: NotificationJournalRecord,
  attempts: NotificationAttemptRecord[] = []
) {
  const content = contentOf(record.content)
  return {
    id: record.id,
    type: record.type,
    recipient: maskNotificationRecipient(record.recipient),
    channel: record.channel,
    state: record.state,
    reason: record.reason,
    template_key: record.template_key,
    template_revision: record.template_revision,
    text_origin: record.text_origin,
    is_test: record.is_test,
    created_at: record.created_at,
    order_id: orderIdFromNotification(record),
    order_display_id: optionalString(content.display_id),
    subject: maskNotificationSecrets(optionalString(content.subject)),
    text: maskNotificationSecrets(optionalString(content.text) ?? optionalString(content.body)),
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      number: attempt.attempt_number,
      attempted_at: attempt.attempted_at,
      result: attempt.result,
      reason: diagnosticReason(attempt.safe_diagnostics),
    })),
  }
}
