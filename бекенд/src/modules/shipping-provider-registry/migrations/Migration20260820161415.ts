import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260820161415 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "shipping_pickup_point" ("id" text not null, "provider_key" text not null, "external_id" text not null, "name" text not null, "city" text not null, "city_code" integer null, "address" text not null, "lat" real null, "lng" real null, "schedule" text null, "point_type" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipping_pickup_point_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_pickup_point_deleted_at" ON "shipping_pickup_point" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "shipping_pickup_point" cascade;`);
  }

}
