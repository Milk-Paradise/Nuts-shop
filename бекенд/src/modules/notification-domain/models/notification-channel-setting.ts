import { model } from "@medusajs/framework/utils"

const NotificationChannelSetting = model
  .define("notification_channel_setting", {
    id: model.id().primaryKey(),
    channel: model.enum(["email", "telegram", "sms"]),
    version: model.number(),
    enabled: model.boolean().default(false),
    encrypted_credentials: model.text().nullable(),
    configuration: model.json().default({}),
    daily_limit: model.number().nullable(),
    verified_at: model.dateTime().nullable(),
    revoked_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_notification_channel_setting_version_unique",
      on: ["channel", "version"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default NotificationChannelSetting
