import { model } from "@medusajs/framework/utils"

const MoyskladOrderSync = model.define("moysklad_order_sync", {
  id: model.id().primaryKey(),
  order_id: model.text().unique(),
  status: model
    .enum(["pending", "synced", "error", "syncing"])
    .default("pending"),
  moysklad_order_id: model.text().nullable(),
  last_error: model.text().nullable(),
  retryable: model.boolean().default(true),
  attempts: model.number().default(0),
  // Cancellation-mark tracking is independent from the create-sync fields
  // above so a cancellation retry never resets `status`/`attempts` (which
  // would make an already-synced order look unsynced again), and its own
  // timestamp is separate from the framework `updated_at` so a create-side
  // reconciliation write can't reset the cancellation retry due-check.
  cancellation_status: model
    .enum(["pending", "synced", "error", "syncing"])
    .nullable(),
  cancellation_attempts: model.number().default(0),
  cancellation_last_error: model.text().nullable(),
  cancellation_updated_at: model.dateTime().nullable(),
  payment_status: model
    .enum(["pending", "synced", "error", "syncing"])
    .nullable(),
  payment_attempts: model.number().default(0),
  payment_last_error: model.text().nullable(),
  payment_paid_at: model.dateTime().nullable(),
  payment_amount: model.number().nullable(),
  payment_currency_code: model.text().nullable(),
  payment_updated_at: model.dateTime().nullable(),
  payment_external_code: model.text().nullable(),
  moysklad_payment_id: model.text().nullable(),
  fulfillment_status: model
    .enum(["pending", "synced", "error", "syncing"])
    .nullable(),
  fulfillment_attempts: model.number().default(0),
  fulfillment_last_error: model.text().nullable(),
  fulfillment_updated_at: model.dateTime().nullable(),
  moysklad_demand_id: model.text().nullable(),
})

export default MoyskladOrderSync
