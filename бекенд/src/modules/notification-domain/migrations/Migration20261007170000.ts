import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261007170000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table if exists "notification_message" add column if not exists "next_attempt_at" timestamptz null;'
    )
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_notification_message_retry_due" ON "notification_message" ("state", "next_attempt_at") WHERE deleted_at IS NULL AND state = \'retry_pending\';'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_notification_message_retry_due";')
    this.addSql(
      'alter table if exists "notification_message" drop column if exists "next_attempt_at";'
    )
  }
}
