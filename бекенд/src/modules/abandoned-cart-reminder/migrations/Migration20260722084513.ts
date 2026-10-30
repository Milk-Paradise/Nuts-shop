import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260722084513 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "abandoned_cart_reminder" drop constraint if exists "abandoned_cart_reminder_cart_id_unique";`);
    this.addSql(`create table if not exists "abandoned_cart_reminder" ("id" text not null, "cart_id" text not null, "sent_at" timestamptz not null, "cart_updated_at_at_send" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "abandoned_cart_reminder_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abandoned_cart_reminder_deleted_at" ON "abandoned_cart_reminder" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_abandoned_cart_reminder_cart_id_unique" ON "abandoned_cart_reminder" ("cart_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "abandoned_cart_reminder" cascade;`);
  }

}
