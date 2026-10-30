import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261004195431 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "payment_operation" ("id" text not null, "type" text check ("type" in ('payment', 'refund', 'cancellation')) not null, "original_payment_id" text null, "provider_id" text not null, "cart_id" text null, "order_id" text null, "return_request_id" text null, "amount" numeric not null, "currency_code" text not null, "state" text check ("state" in ('processing', 'completed', 'retry_pending', 'retries_exhausted', 'result_unknown', 'declined_final')) not null default 'processing', "provider_operation_id" text null, "idempotency_key" text not null, "result_reflected_at" timestamptz null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_operation_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_operation_idempotency_key_unique" ON "payment_operation" ("idempotency_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_operation_deleted_at" ON "payment_operation" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_operation_cart" ON "payment_operation" ("cart_id") WHERE deleted_at IS NULL AND cart_id IS NOT NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_operation_order" ON "payment_operation" ("order_id") WHERE deleted_at IS NULL AND order_id IS NOT NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_operation_original_payment" ON "payment_operation" ("original_payment_id") WHERE deleted_at IS NULL AND original_payment_id IS NOT NULL;`);

    this.addSql(`create table if not exists "payment_operation_attempt" ("id" text not null, "operation_id" text not null, "number" integer not null, "action" text not null, "result" text not null, "error_category" text null, "error_reason" text null, "external_event_key" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_operation_attempt_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_operation_attempt_operation_id" ON "payment_operation_attempt" ("operation_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_operation_attempt_deleted_at" ON "payment_operation_attempt" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_operation_attempt_number_unique" ON "payment_operation_attempt" ("operation_id", "number") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_operation_attempt_event_unique" ON "payment_operation_attempt" ("external_event_key") WHERE deleted_at IS NULL AND external_event_key IS NOT NULL;`);

    this.addSql(`alter table if exists "payment_operation_attempt" add constraint "payment_operation_attempt_operation_id_foreign" foreign key ("operation_id") references "payment_operation" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payment_operation_attempt" drop constraint if exists "payment_operation_attempt_operation_id_foreign";`);

    this.addSql(`drop table if exists "payment_operation" cascade;`);

    this.addSql(`drop table if exists "payment_operation_attempt" cascade;`);
  }

}
