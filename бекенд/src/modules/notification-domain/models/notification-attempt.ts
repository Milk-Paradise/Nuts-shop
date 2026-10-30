import { model } from "@medusajs/framework/utils"

const NotificationAttempt = model
  .define("notification_attempt", {
    id: model.id().primaryKey(),
    notification_id: model.text(),
    attempt_number: model.number(),
    attempted_at: model.dateTime(),
    channel_setting_version_id: model.text().nullable(),
    external_id: model.text().nullable(),
    result: model.enum([
      "in_flight",
      "success",
      "temporary_failure",
      "permanent_failure",
      "unknown",
    ]),
    safe_diagnostics: model.json().default({}),
  })
  .indexes([
    {
      name: "IDX_notification_attempt_number_unique",
      on: ["notification_id", "attempt_number"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default NotificationAttempt
