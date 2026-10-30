import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261007132421 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "notification_telegram_binding" drop constraint if exists "notification_telegram_binding_token_unique";`);
    this.addSql(`alter table if exists "notification_telegram_binding" drop constraint if exists "notification_telegram_binding_account_unique";`);
    this.addSql(`alter table if exists "notification_sms_daily_counter" drop constraint if exists "notification_sms_daily_counter_bucket_unique";`);
    this.addSql(`alter table if exists "notification_message" drop constraint if exists "notification_message_identity_unique";`);
    this.addSql(`alter table if exists "notification_channel_setting" drop constraint if exists "notification_channel_setting_version_unique";`);
    this.addSql(`alter table if exists "notification_attempt" drop constraint if exists "notification_attempt_number_unique";`);
    this.addSql(`create table if not exists "notification_attempt" ("id" text not null, "notification_id" text not null, "attempt_number" integer not null, "attempted_at" timestamptz not null, "channel_setting_version_id" text null, "external_id" text null, "result" text check ("result" in ('success', 'temporary_failure', 'permanent_failure', 'unknown')) not null, "safe_diagnostics" jsonb not null default '{}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "notification_attempt_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_attempt_deleted_at" ON "notification_attempt" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_attempt_number_unique" ON "notification_attempt" ("notification_id", "attempt_number") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "notification_channel_setting" ("id" text not null, "channel" text check ("channel" in ('email', 'telegram', 'sms')) not null, "version" integer not null, "enabled" boolean not null default false, "encrypted_credentials" text null, "configuration" jsonb not null default '{}', "daily_limit" integer null, "verified_at" timestamptz null, "revoked_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "notification_channel_setting_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_channel_setting_deleted_at" ON "notification_channel_setting" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_channel_setting_version_unique" ON "notification_channel_setting" ("channel", "version") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "notification_message" ("id" text not null, "event_key" text not null, "type" text not null, "recipient" text not null, "channel" text check ("channel" in ('email', 'telegram', 'sms', 'none')) not null, "state" text check ("state" in ('processing', 'completed', 'retry_pending', 'retries_exhausted', 'permanently_rejected', 'outcome_unknown')) not null default 'processing', "reason" text null, "template_key" text null, "template_revision" text null, "text_origin" text check ("text_origin" in ('template', 'fallback')) not null, "is_test" boolean not null default false, "content" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "notification_message_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_message_deleted_at" ON "notification_message" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_message_identity_unique" ON "notification_message" ("event_key", "type", "recipient", "channel") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_message_state_channel" ON "notification_message" ("state", "channel") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "notification_sms_daily_counter" ("id" text not null, "calendar_date" text not null, "timezone" text not null, "count" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "notification_sms_daily_counter_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_sms_daily_counter_deleted_at" ON "notification_sms_daily_counter" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_sms_daily_counter_bucket_unique" ON "notification_sms_daily_counter" ("calendar_date", "timezone") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "notification_telegram_binding" ("id" text not null, "account_id" text not null, "chat_id" text null, "state" text check ("state" in ('pending', 'active', 'disabled')) not null default 'pending', "token_hash" text null, "token_expires_at" timestamptz null, "token_used_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "notification_telegram_binding_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_telegram_binding_deleted_at" ON "notification_telegram_binding" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_telegram_binding_account_unique" ON "notification_telegram_binding" ("account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_telegram_binding_token_unique" ON "notification_telegram_binding" ("token_hash") WHERE deleted_at IS NULL AND token_hash IS NOT NULL;`);

    this.addSql(`insert into "notification_channel_setting" ("id", "channel", "version", "enabled", "configuration", "daily_limit") values ('notification-channel-email-v1', 'email', 1, true, '{}', null), ('notification-channel-telegram-v1', 'telegram', 1, false, '{}', null), ('notification-channel-sms-v1', 'sms', 1, false, '{}', 100) on conflict do nothing;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "notification_attempt" cascade;`);

    this.addSql(`drop table if exists "notification_channel_setting" cascade;`);

    this.addSql(`drop table if exists "notification_message" cascade;`);

    this.addSql(`drop table if exists "notification_sms_daily_counter" cascade;`);

    this.addSql(`drop table if exists "notification_telegram_binding" cascade;`);
  }

}
