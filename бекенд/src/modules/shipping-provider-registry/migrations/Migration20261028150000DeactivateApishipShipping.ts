import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261028150000DeactivateApishipShipping extends Migration {
  override async up(): Promise<void> {
    const retiredCarrierKey = "apiship"
    const retiredProviderKey = `${retiredCarrierKey}_${retiredCarrierKey}`
    const retiredKeys = `'${retiredCarrierKey}', '${retiredProviderKey}'`
    const deactivateRetiredRecords = (table: string, column: string) => {
      this.addSql(`do $$ begin if to_regclass('${table}') is not null then update "${table}" set "deleted_at" = coalesce("deleted_at", now()), "updated_at" = now() where "${column}" in (${retiredKeys}) and "deleted_at" is null; end if; end $$;`)
    }

    deactivateRetiredRecords("shipping_webhook_event", "provider_key")
    deactivateRetiredRecords("shipping_return_request", "provider_key")
    deactivateRetiredRecords("shipping_shipment", "provider_key")
    deactivateRetiredRecords("shipping_pickup_point", "provider_key")
    deactivateRetiredRecords("shipping_provider_config", "provider_key")
    deactivateRetiredRecords("shipping_provider_visibility", "provider_key")

    // Match Medusa's delete-shipping-options workflow: soft-delete the option
    // and its links while preserving historical fulfillments and the shared
    // option type, service zone, and fulfillment set.
    this.addSql(`do $$ begin if to_regclass('shipping_option_price_set') is not null and to_regclass('shipping_option') is not null then update "shipping_option_price_set" set "deleted_at" = coalesce("deleted_at", now()), "updated_at" = now() where "shipping_option_id" in (select "id" from "shipping_option" where "provider_id" in (${retiredKeys})) and "deleted_at" is null; end if; end $$;`)
    this.addSql(`do $$ begin if to_regclass('shipping_option_rule') is not null and to_regclass('shipping_option') is not null then update "shipping_option_rule" set "deleted_at" = coalesce("deleted_at", now()), "updated_at" = now() where "shipping_option_id" in (select "id" from "shipping_option" where "provider_id" in (${retiredKeys})) and "deleted_at" is null; end if; end $$;`)
    deactivateRetiredRecords("shipping_option", "provider_id")
    deactivateRetiredRecords("location_fulfillment_provider", "fulfillment_provider_id")

    // Keep the disabled provider row because historical fulfillments still
    // reference it. Runtime registration was removed by AIL-111.
    this.addSql(`do $$ begin if to_regclass('fulfillment_provider') is not null then update "fulfillment_provider" set "is_enabled" = false, "updated_at" = now() where "id" in (${retiredKeys}); end if; end $$;`)
  }

  override async down(): Promise<void> {
    // The provider no longer exists in the runtime, so restoring selectable
    // ApiShip configuration would recreate the production failure.
  }
}
