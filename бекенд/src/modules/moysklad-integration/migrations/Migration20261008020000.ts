import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261008020000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "moysklad_order_sync" add column if not exists "fulfillment_status" text check ("fulfillment_status" in ('pending', 'synced', 'error', 'syncing')) null, add column if not exists "fulfillment_attempts" integer not null default 0, add column if not exists "fulfillment_last_error" text null, add column if not exists "fulfillment_updated_at" timestamptz null, add column if not exists "moysklad_demand_id" text null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "moysklad_order_sync" drop column if exists "fulfillment_status", drop column if exists "fulfillment_attempts", drop column if exists "fulfillment_last_error", drop column if exists "fulfillment_updated_at", drop column if exists "moysklad_demand_id";`
    )
  }
}
