import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261004120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "payment_provider_availability" ("id" text not null, "provider_id" text not null, "store_id" text not null, "region_id" text not null, "is_enabled" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_provider_availability_pkey" primary key ("id"));`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_provider_availability_scope_unique" ON "payment_provider_availability" ("provider_id", "store_id", "region_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_provider_availability_deleted_at" ON "payment_provider_availability" ("deleted_at") WHERE deleted_at IS NULL;`)

    // Preserve the current single-store behavior while moving availability to
    // its own additive registry. Previous application versions ignore this table.
    this.addSql(`insert into "payment_provider_availability" ("id", "provider_id", "store_id", "region_id", "is_enabled") select 'ppavail_' || md5(config."provider_id" || ':' || store."id" || ':' || store."default_region_id"), config."provider_id", store."id", store."default_region_id", config."is_enabled" from "payment_provider_config" config cross join "store" store where config."deleted_at" is null and store."deleted_at" is null and store."default_region_id" is not null and not exists (select 1 from "payment_provider_availability" existing where existing."provider_id" = config."provider_id" and existing."store_id" = store."id" and existing."region_id" = store."default_region_id" and existing."deleted_at" is null);`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payment_provider_availability" cascade;`)
  }
}
