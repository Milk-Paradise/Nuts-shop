import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261006000000AddVersionAuditLog extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "cart" add column if not exists "version" integer not null default 0;`
    )
    this.addSql(
      `alter table if exists "cart" add column if not exists "guest_owner_hash" varchar(64) null;`
    )
    this.addSql(
      `create index if not exists "IDX_cart_customer_id" on "cart" ("customer_id");`
    )
    this.addSql(
      `create unique index if not exists "IDX_cart_guest_owner_hash_unique" on "cart" ("guest_owner_hash");`
    )
    this.addSql(`
      create table if not exists "audit_log" (
        "id" text not null,
        "cart_id" text not null,
        "operation" varchar(50) not null,
        "before_version" integer not null,
        "after_version" integer not null,
        "created_at" timestamptz not null default now(),
        constraint "audit_log_pkey" primary key ("id"),
        constraint "audit_log_operation_check" check ("operation" in ('update', 'merge', 'expire')),
        constraint "audit_log_cart_id_foreign" foreign key ("cart_id") references "cart" ("id")
      );
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "audit_log";`)
    this.addSql(`drop index if exists "IDX_cart_guest_owner_hash_unique";`)
    this.addSql(
      `alter table if exists "cart" drop column if exists "guest_owner_hash";`
    )
    this.addSql(
      `alter table if exists "cart" drop column if exists "version";`
    )
  }
}
