import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261009162451 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "notification_telegram_binding" add column if not exists "username" text null, add column if not exists "display_name" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "notification_telegram_binding" drop column if exists "username", drop column if exists "display_name";`);
  }

}
