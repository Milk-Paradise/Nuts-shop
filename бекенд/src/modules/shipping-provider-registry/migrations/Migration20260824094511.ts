import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260824094511 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "shipping_shipment" add column if not exists "reconciliation_required" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "shipping_shipment" drop column if exists "reconciliation_required";`);
  }

}
