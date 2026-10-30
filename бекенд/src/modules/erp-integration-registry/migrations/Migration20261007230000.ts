import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261007230000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "erp_integration" (
        "id" text not null,
        "integration_key" text not null,
        "display_name" text not null,
        "is_active" boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "erp_integration_pkey" primary key ("id")
      );
    `)
    this.addSql(
      `create unique index if not exists "IDX_erp_integration_key_unique" on "erp_integration" ("integration_key") where "deleted_at" is null;`
    )
    this.addSql(
      `create unique index if not exists "IDX_erp_integration_single_active" on "erp_integration" ("is_active") where "is_active" = true and "deleted_at" is null;`
    )
    this.addSql(
      `create index if not exists "IDX_erp_integration_deleted_at" on "erp_integration" ("deleted_at") where "deleted_at" is null;`
    )
    this.addSql(`
      do $$
      begin
        if to_regclass('public.moysklad_connection_config') is not null then
          insert into "erp_integration" ("id", "integration_key", "display_name", "is_active")
          select 'erp_moysklad', 'moysklad', 'МойСклад', "is_active"
          from "moysklad_connection_config"
          where "id" = 'default'
          on conflict do nothing;
        end if;
      end $$;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "erp_integration" cascade;`)
  }
}
