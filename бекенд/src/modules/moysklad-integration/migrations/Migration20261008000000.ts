import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261008000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "moysklad_connection_config" add column if not exists "credentials_status" text not null default 'configured';`
    )
    this.addSql(
      `alter table "moysklad_connection_config" add column if not exists "credentials_attention_reason" text null;`
    )
    this.addSql(
      `alter table "moysklad_connection_config" add column if not exists "stock_sync_schedule" text not null default '*/15 * * * *';`
    )
    this.addSql(
      `alter table "moysklad_connection_config" add column if not exists "order_sync_retry_schedule" text not null default '* * * * *';`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "moysklad_connection_config" drop column if exists "order_sync_retry_schedule", drop column if exists "stock_sync_schedule", drop column if exists "credentials_attention_reason", drop column if exists "credentials_status";`
    )
  }
}
