import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260713144758 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "shipping_provider_visibility" drop constraint if exists "shipping_provider_visibility_provider_key_unique";`);
    this.addSql(`create table if not exists "shipping_provider_visibility" ("id" text not null, "provider_key" text not null, "is_visible" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shipping_provider_visibility_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shipping_provider_visibility_provider_key_unique" ON "shipping_provider_visibility" ("provider_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shipping_provider_visibility_deleted_at" ON "shipping_provider_visibility" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "shipping_provider_visibility" cascade;`);
  }

}
