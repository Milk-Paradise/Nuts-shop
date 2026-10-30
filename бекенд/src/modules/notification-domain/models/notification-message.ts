import { model } from "@medusajs/framework/utils"

export const NOTIFICATION_CHANNELS = ["email", "telegram", "sms", "none"]
export const NOTIFICATION_STATES = [
  "processing",
  "completed",
  "retry_pending",
  "retries_exhausted",
  "permanently_rejected",
  "outcome_unknown",
]

const NotificationMessage = model
  .define("notification_message", {
    id: model.id().primaryKey(),
    event_key: model.text(),
    type: model.text(),
    recipient: model.text(),
    channel: model.enum(NOTIFICATION_CHANNELS),
    state: model.enum(NOTIFICATION_STATES).default("processing"),
    reason: model.text().nullable(),
    next_attempt_at: model.dateTime().nullable(),
    lease_token: model.text().nullable(),
    lease_expires_at: model.dateTime().nullable(),
    template_key: model.text().nullable(),
    template_revision: model.text().nullable(),
    text_origin: model.enum(["template", "fallback"]),
    is_test: model.boolean().default(false),
    content: model.json(),
  })
  .indexes([
    {
      name: "IDX_notification_message_identity_unique",
      on: ["event_key", "type", "recipient", "channel"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_notification_message_state_channel",
      on: ["state", "channel"],
      where: "deleted_at IS NULL",
    },
  ])

export default NotificationMessage
