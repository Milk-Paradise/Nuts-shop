import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260820114608 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "moysklad_connection_config" add column if not exists "stock_sync_last_error" text null, add column if not exists "stock_sync_last_attempt_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "moysklad_connection_config" drop column if exists "stock_sync_last_error", drop column if exists "stock_sync_last_attempt_at";`);
  }

}
