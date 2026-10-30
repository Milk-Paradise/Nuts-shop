import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261010000000AddAuditCartIndex extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create index if not exists "IDX_audit_log_cart_created" on "audit_log" ("cart_id", "created_at");`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_audit_log_cart_created";`)
  }
}
