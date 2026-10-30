import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260724124901 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "moysklad_order_sync" drop constraint if exists "moysklad_order_sync_order_id_unique";`);
    this.addSql(`create table if not exists "moysklad_order_sync" ("id" text not null, "order_id" text not null, "status" text check ("status" in ('pending', 'synced', 'error')) not null default 'pending', "moysklad_order_id" text null, "last_error" text null, "attempts" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "moysklad_order_sync_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_moysklad_order_sync_order_id_unique" ON "moysklad_order_sync" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_moysklad_order_sync_deleted_at" ON "moysklad_order_sync" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "moysklad_order_sync" cascade;`);
  }

}
