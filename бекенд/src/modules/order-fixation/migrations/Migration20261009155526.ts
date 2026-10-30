import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261009155526 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "order_fixation" drop constraint if exists "order_fixation_order_unique";`);
    this.addSql(`alter table if exists "order_fixation" drop constraint if exists "order_fixation_cart_unique";`);
    this.addSql(`create table if not exists "order_fixation" ("id" text not null, "cart_id" text not null, "request_fingerprint" text not null, "order_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "order_fixation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_fixation_deleted_at" ON "order_fixation" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_fixation_cart_unique" ON "order_fixation" ("cart_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_fixation_order_unique" ON "order_fixation" ("order_id") WHERE deleted_at IS NULL AND order_id IS NOT NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "order_fixation" cascade;`);
  }

}
