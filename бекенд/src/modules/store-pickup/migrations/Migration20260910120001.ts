import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260910120001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "store_pickup_setting" ("id" text not null, "address" text not null default '', "hours" text not null default '', "is_enabled" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "store_pickup_setting_pkey" primary key ("id"));`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_pickup_setting_deleted_at" ON "store_pickup_setting" ("deleted_at") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "store_pickup_setting" cascade;`)
  }
}
