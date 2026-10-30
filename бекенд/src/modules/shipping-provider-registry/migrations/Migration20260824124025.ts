import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260824124025 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "shipping_return_request" drop constraint if exists "shipping_return_request_order_pending_unique";`);
    this.addSql(`alter table if exists "shipping_return_request" add column if not exists "previous_delivery_status" text check ("previous_delivery_status" in ('placed', 'preparing', 'in_transit', 'delivered', 'cancelled', 'return_in_progress')) null, add column if not exists "return_provider_shipment_id" text null, add column if not exists "return_delivery_status" text check ("return_delivery_status" in ('placed', 'preparing', 'in_transit', 'delivered', 'cancelled', 'return_in_progress')) null, add column if not exists "return_status_event_at" timestamptz null;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shipping_return_request_order_pending_unique" ON "shipping_return_request" ("order_id") WHERE deleted_at IS NULL AND status = 'pending';`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_return_request_provider_shipment" ON "shipping_return_request" ("return_provider_shipment_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_shipping_return_request_order_pending_unique";`);
    this.addSql(`drop index if exists "IDX_shipping_return_request_provider_shipment";`);
    this.addSql(`alter table if exists "shipping_return_request" drop column if exists "previous_delivery_status", drop column if exists "return_provider_shipment_id", drop column if exists "return_delivery_status", drop column if exists "return_status_event_at";`);
  }

}
