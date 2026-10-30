import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Migration20260814145000 убрала колонку "kind" из site_link и завела таблицу
// site_review_link, но модели, сервиса и кода для неё в проекте нет: SiteLink
// по-прежнему объявляет "kind", а ссылка на отзывы читается именно из него.
// Схема возвращается к тому, что описывают модели, иначе любой запрос с
// фильтром по kind падает с "column s0.kind does not exist".
export class Migration20260818150000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "site_link" add column if not exists "kind" text check ("kind" in ('social', 'reviews')) not null default 'social';`)
    this.addSql(`alter table "site_link" alter column "label" drop not null;`)
    this.addSql(`insert into "site_link" ("id", "kind", "label", "url", "rank") select "id", 'reviews', null, "url", 0 from "site_review_link" where "deleted_at" is null limit 1 on conflict do nothing;`)
    this.addSql(`alter table "site_link" alter column "kind" drop default;`)
    this.addSql(`drop table if exists "site_review_link" cascade;`)
  }

  async down(): Promise<void> {
    this.addSql(`create table if not exists "site_review_link" ("id" text not null, "key" text check ("key" in ('reviews')) not null, "url" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "site_review_link_pkey" primary key ("id"));`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_site_review_link_key_unique" ON "site_review_link" ("key") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_site_review_link_deleted_at" ON "site_review_link" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`insert into "site_review_link" ("id", "key", "url") select "id", 'reviews', "url" from "site_link" where "kind" = 'reviews' and "deleted_at" is null order by "rank" asc limit 1 on conflict do nothing;`)
    this.addSql(`delete from "site_link" where "kind" = 'reviews';`)
    this.addSql(`delete from "site_link" where "label" is null;`)
    this.addSql(`alter table "site_link" drop column if exists "kind";`)
    this.addSql(`alter table "site_link" alter column "label" set not null;`)
  }
}
