import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260727140559 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "moysklad_order_sync" add column if not exists "cancellation_status" text check ("cancellation_status" in ('pending', 'synced', 'error', 'syncing')) null, add column if not exists "cancellation_attempts" integer not null default 0, add column if not exists "cancellation_last_error" text null, add column if not exists "cancellation_updated_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "moysklad_order_sync" drop column if exists "cancellation_status", drop column if exists "cancellation_attempts", drop column if exists "cancellation_last_error", drop column if exists "cancellation_updated_at";`);
  }

}
