import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261027082106 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "shipping_cdek_city_resolution_cache" ("id" text not null, "country_code" text not null, "city" text not null, "region" text not null default '', "postal_code" text not null default '', "city_code" integer not null, "candidate" jsonb not null, "fetched_at" timestamptz not null, "expires_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipping_cdek_city_resolution_cache_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_cdek_city_resolution_cache_deleted_at" ON "shipping_cdek_city_resolution_cache" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shipping_cdek_city_resolution_cache_key_unique" ON "shipping_cdek_city_resolution_cache" ("country_code", "city", "region", "postal_code") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "shipping_cdek_city_resolution_cache" cascade;`);
  }

}
