import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260907120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "moysklad_order_sync" add column if not exists "retryable" boolean not null default true;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "moysklad_order_sync" drop column if exists "retryable";`
    )
  }
}
