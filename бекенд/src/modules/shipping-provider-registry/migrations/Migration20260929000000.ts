import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260929000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop index if exists "IDX_shipping_shipment_order_provider_unique";`)
    this.addSql(`alter table if exists "shipping_shipment" add column if not exists "business_action_id" text null, add column if not exists "direction" text check ("direction" in ('forward', 'return')) not null default 'forward', add column if not exists "destination_key" text null;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shipping_shipment_order_provider_direction_unique" ON "shipping_shipment" ("order_id", "provider_key", "direction") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shipping_shipment_action_direction_destination_unique" ON "shipping_shipment" ("business_action_id", "direction", "destination_key") WHERE deleted_at IS NULL AND business_action_id IS NOT NULL AND destination_key IS NOT NULL;`)
  }

  override async down(): Promise<void> {
    // Additive rollback is intentional. Forward and return rows, their identity
    // columns are valid production data and cannot safely be collapsed into the
    // old schema. The partial legacy index protects the
    // rows old code can create (direction defaults to forward) without making an
    // existing forward+return pair collide during rollback.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shipping_shipment_order_provider_unique" ON "shipping_shipment" ("order_id", "provider_key") WHERE deleted_at IS NULL AND direction = 'forward';`)
  }
}
