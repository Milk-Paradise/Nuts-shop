import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260724143840 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "moysklad_order_sync" drop constraint if exists "moysklad_order_sync_status_check";`);

    this.addSql(`alter table if exists "moysklad_order_sync" add constraint "moysklad_order_sync_status_check" check("status" in ('pending', 'synced', 'error', 'syncing'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "moysklad_order_sync" drop constraint if exists "moysklad_order_sync_status_check";`);

    this.addSql(`alter table if exists "moysklad_order_sync" add constraint "moysklad_order_sync_status_check" check("status" in ('pending', 'synced', 'error'));`);
  }

}
