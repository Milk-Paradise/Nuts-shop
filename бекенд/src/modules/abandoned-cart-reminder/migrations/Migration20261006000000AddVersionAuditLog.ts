// The core Cart module is owned by Medusa and can't load application migrations.
// Re-export the application-owned migration through this always-enabled,
// cart-related module so `medusa db:migrate` discovers it without replacing the
// core module or changing medusa-config.ts.
export { Migration20261006000000AddVersionAuditLog } from "../../cart/migrations/Migration20261006000000AddVersionAuditLog"
