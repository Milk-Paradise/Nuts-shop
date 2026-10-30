import { model } from "@medusajs/framework/utils"

const MoyskladConnectionConfig = model.define("moysklad_connection_config", {
  id: model.id().primaryKey(),
  encrypted_credentials: model.text(),
  is_active: model.boolean().default(false),
  credentials_status: model.enum(["configured", "needs_reentry"]).default("configured"),
  credentials_attention_reason: model.text().nullable(),
  stock_sync_schedule: model.text().default("*/15 * * * *"),
  catalog_sync_schedule: model.text().default("0 * * * *"),
  order_sync_retry_schedule: model.text().default("* * * * *"),
  stock_sync_last_error: model.text().nullable(),
  stock_sync_last_attempt_at: model.dateTime().nullable(),
  stock_sync_last_success_at: model.dateTime().nullable(),
  stock_sync_unmatched: model.json().default({ items: [] }),
  catalog_sync_last_error: model.text().nullable(),
  catalog_sync_last_attempt_at: model.dateTime().nullable(),
  catalog_sync_last_success_at: model.dateTime().nullable(),
})

export default MoyskladConnectionConfig
