import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260714104609 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "moysklad_connection_config" ("id" text not null, "encrypted_credentials" text not null, "is_active" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "moysklad_connection_config_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_moysklad_connection_config_deleted_at" ON "moysklad_connection_config" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "moysklad_connection_config" cascade;`);
  }

}
