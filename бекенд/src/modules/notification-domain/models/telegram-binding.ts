import { model } from "@medusajs/framework/utils"

const TelegramBinding = model
  .define("notification_telegram_binding", {
    id: model.id().primaryKey(),
    account_id: model.text(),
    chat_id: model.text().nullable(),
    username: model.text().nullable(),
    display_name: model.text().nullable(),
    state: model.enum(["pending", "active", "disabled"]).default("pending"),
    token_hash: model.text().nullable(),
    token_expires_at: model.dateTime().nullable(),
    token_used_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_notification_telegram_binding_account_unique",
      on: ["account_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_notification_telegram_binding_token_unique",
      on: ["token_hash"],
      unique: true,
      where: "deleted_at IS NULL AND token_hash IS NOT NULL",
    },
  ])

export default TelegramBinding
