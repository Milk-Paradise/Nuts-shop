import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260817101610 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "cms_snapshot" drop constraint if exists "cms_snapshot_key_unique";`);
    this.addSql(`create table if not exists "cms_snapshot" ("id" text not null, "key" text not null, "revision" text not null, "payload" jsonb not null, "content_updated_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cms_snapshot_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cms_snapshot_deleted_at" ON "cms_snapshot" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cms_snapshot_key_unique" ON "cms_snapshot" ("key") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "cms_snapshot" cascade;`);
  }

}
