import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260820140559 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "shipping_provider_config" drop constraint if exists "shipping_provider_config_provider_key_unique";`);
    this.addSql(`create table if not exists "shipping_provider_config" ("id" text not null, "provider_key" text not null, "encrypted_credentials" text null, "configuration" jsonb not null default '{}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipping_provider_config_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shipping_provider_config_provider_key_unique" ON "shipping_provider_config" ("provider_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_provider_config_deleted_at" ON "shipping_provider_config" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "shipping_return_request" ("id" text not null, "order_id" text not null, "provider_key" text not null, "status" text check ("status" in ('pending', 'approved', 'rejected')) not null default 'pending', "reason" text null, "return_tracking_number" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipping_return_request_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_return_request_deleted_at" ON "shipping_return_request" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "shipping_store_package" ("id" text not null, "weight_grams" integer not null, "length_mm" integer not null, "width_mm" integer not null, "height_mm" integer not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipping_store_package_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_store_package_deleted_at" ON "shipping_store_package" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "shipping_provider_config" cascade;`);

    this.addSql(`drop table if exists "shipping_return_request" cascade;`);

    this.addSql(`drop table if exists "shipping_store_package" cascade;`);
  }

}
