import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260910120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "moysklad_order_sync" add column if not exists "payment_status" text check ("payment_status" in ('pending', 'synced', 'error', 'syncing')) null, add column if not exists "payment_attempts" integer not null default 0, add column if not exists "payment_last_error" text null, add column if not exists "payment_paid_at" timestamptz null, add column if not exists "payment_amount" double precision null, add column if not exists "payment_currency_code" text null, add column if not exists "payment_updated_at" timestamptz null, add column if not exists "payment_external_code" text null, add column if not exists "moysklad_payment_id" text null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "moysklad_order_sync" drop column if exists "payment_status", drop column if exists "payment_attempts", drop column if exists "payment_last_error", drop column if exists "payment_paid_at", drop column if exists "payment_amount", drop column if exists "payment_currency_code", drop column if exists "payment_updated_at", drop column if exists "payment_external_code", drop column if exists "moysklad_payment_id";`)
  }
}
