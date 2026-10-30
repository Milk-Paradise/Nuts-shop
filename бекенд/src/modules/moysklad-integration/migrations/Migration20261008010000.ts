import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261008010000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "moysklad_connection_config" add column if not exists "catalog_sync_schedule" text not null default '0 * * * *';`
    )
    this.addSql(
      `alter table "moysklad_connection_config" add column if not exists "catalog_sync_last_error" text null;`
    )
    this.addSql(
      `alter table "moysklad_connection_config" add column if not exists "catalog_sync_last_attempt_at" timestamptz null;`
    )
    this.addSql(
      `alter table "moysklad_connection_config" add column if not exists "catalog_sync_last_success_at" timestamptz null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "moysklad_connection_config" drop column if exists "catalog_sync_last_success_at", drop column if exists "catalog_sync_last_attempt_at", drop column if exists "catalog_sync_last_error", drop column if exists "catalog_sync_schedule";`
    )
  }
}
