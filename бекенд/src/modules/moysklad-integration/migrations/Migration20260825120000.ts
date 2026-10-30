import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260825120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "moysklad_connection_config" add column if not exists "stock_sync_last_success_at" timestamptz null, add column if not exists "stock_sync_unmatched" jsonb not null default '{"items":[]}';`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "moysklad_connection_config" drop column if exists "stock_sync_last_success_at", drop column if exists "stock_sync_unmatched";`
    )
  }
}
