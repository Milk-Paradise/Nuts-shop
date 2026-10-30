import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261008150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table if exists "notification_attempt" drop constraint if exists "notification_attempt_result_check";'
    )
    this.addSql(
      'alter table if exists "notification_attempt" add constraint "notification_attempt_result_check" check ("result" in (\'in_flight\', \'success\', \'temporary_failure\', \'permanent_failure\', \'unknown\'));'
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      'update "notification_attempt" set "result" = \'unknown\' where "result" = \'in_flight\';'
    )
    this.addSql(
      'alter table if exists "notification_attempt" drop constraint if exists "notification_attempt_result_check";'
    )
    this.addSql(
      'alter table if exists "notification_attempt" add constraint "notification_attempt_result_check" check ("result" in (\'success\', \'temporary_failure\', \'permanent_failure\', \'unknown\'));'
    )
  }
}
