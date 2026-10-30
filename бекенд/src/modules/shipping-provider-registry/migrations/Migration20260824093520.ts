import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260824093520 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "shipping_shipment" drop constraint if exists "shipping_shipment_order_provider_unique";`);
    this.addSql(`create table if not exists "shipping_shipment" ("id" text not null, "order_id" text not null, "provider_key" text not null, "status" text check ("status" in ('creating', 'created', 'failed')) not null default 'creating', "provider_shipment_id" text null, "tracking_number" text null, "error_message" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipping_shipment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_shipment_deleted_at" ON "shipping_shipment" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shipping_shipment_order_provider_unique" ON "shipping_shipment" ("order_id", "provider_key") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "shipping_shipment" cascade;`);
  }

}
