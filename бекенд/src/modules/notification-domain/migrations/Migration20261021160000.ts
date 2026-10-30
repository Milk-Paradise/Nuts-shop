import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261021160000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "notification_message" add column if not exists "lease_token" text null, add column if not exists "lease_expires_at" timestamptz null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "notification_message" drop column if exists "lease_token", drop column if exists "lease_expires_at";`
    )
  }
}
