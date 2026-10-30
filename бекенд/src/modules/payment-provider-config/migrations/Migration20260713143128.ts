import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260713143128 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "payment_provider_config" drop constraint if exists "payment_provider_config_provider_id_unique";`);
    this.addSql(`create table if not exists "payment_provider_config" ("id" text not null, "provider_id" text not null, "shop_id" text null, "encrypted_secret_key" text null, "mode" text check ("mode" in ('test', 'live')) not null default 'test', "is_enabled" boolean not null default false, "created_by_user_id" text null, "updated_by_user_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_provider_config_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_provider_config_provider_id_unique" ON "payment_provider_config" ("provider_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_provider_config_deleted_at" ON "payment_provider_config" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payment_provider_config" cascade;`);
  }

}
