import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260721230048 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "site_tab" drop constraint if exists "site_tab_key_unique";`);
    this.addSql(`create table if not exists "site_link" ("id" text not null, "kind" text check ("kind" in ('social', 'reviews')) not null, "label" text null, "url" text not null, "rank" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "site_link_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_site_link_deleted_at" ON "site_link" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "site_tab" ("id" text not null, "key" text check ("key" in ('catalog', 'brands', 'contacts', 'about', 'paint_selection', 'delivery')) not null, "content" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "site_tab_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_site_tab_key_unique" ON "site_tab" ("key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_site_tab_deleted_at" ON "site_tab" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "site_link" cascade;`);

    this.addSql(`drop table if exists "site_tab" cascade;`);
  }

}
