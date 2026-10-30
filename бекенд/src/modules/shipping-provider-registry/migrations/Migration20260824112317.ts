import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260824112317 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "shipping_webhook_event" drop constraint if exists "shipping_webhook_event_event_uuid_unique";`);
    this.addSql(`create table if not exists "shipping_webhook_event" ("id" text not null, "event_uuid" text not null, "provider_key" text not null, "event_type" text not null, "event_at" timestamptz not null, "shipment_id" text null, "applied" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipping_webhook_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shipping_webhook_event_event_uuid_unique" ON "shipping_webhook_event" ("event_uuid") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_webhook_event_deleted_at" ON "shipping_webhook_event" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "shipping_shipment" add column if not exists "simplified_status" text check ("simplified_status" in ('placed', 'preparing', 'in_transit', 'delivered', 'cancelled', 'return_in_progress')) not null default 'placed', add column if not exists "status_event_at" timestamptz null, add column if not exists "status_event_uuid" text null, add column if not exists "label_request_uuid" text null, add column if not exists "label_url" text null, add column if not exists "label_event_uuid" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_shipment_provider_shipment" ON "shipping_shipment" ("provider_shipment_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_shipment_label_request" ON "shipping_shipment" ("label_request_uuid") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "shipping_webhook_event" cascade;`);

    this.addSql(`drop index if exists "IDX_shipping_shipment_provider_shipment";`);
    this.addSql(`drop index if exists "IDX_shipping_shipment_label_request";`);
    this.addSql(`alter table if exists "shipping_shipment" drop column if exists "simplified_status", drop column if exists "status_event_at", drop column if exists "status_event_uuid", drop column if exists "label_request_uuid", drop column if exists "label_url", drop column if exists "label_event_uuid";`);
  }

}
