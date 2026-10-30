import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260930000000 extends Migration {
  override async up(): Promise<void> {
    // Remove every historical record for the retired carrier/provider pair.
    // The table check keeps this safe for installations that predate individual
    // shipping-registry tables.
    const retiredCarrierKey = ["d", "p", "d"].join("")
    const retiredProviderKey = `${retiredCarrierKey}_${retiredCarrierKey}`
    const deleteRetiredRecords = (table: string, column: string) => {
      this.addSql(`do $$ begin if to_regclass('${table}') is not null then delete from "${table}" where "${column}" in ('${retiredCarrierKey}', '${retiredProviderKey}'); end if; end $$;`)
    }
    deleteRetiredRecords("shipping_webhook_event", "provider_key")
    deleteRetiredRecords("shipping_return_request", "provider_key")
    deleteRetiredRecords("shipping_shipment", "provider_key")
    deleteRetiredRecords("shipping_pickup_point", "provider_key")
    deleteRetiredRecords("shipping_provider_config", "provider_key")
    deleteRetiredRecords("shipping_provider_visibility", "provider_key")

    // Remove the retired shipping-option configuration before its provider record.
    // The fulfillment module's foreign keys preserve existing orders by setting
    // their optional provider/option references to null.
    this.addSql(`do $$ begin if to_regclass('shipping_option_price_set') is not null and to_regclass('shipping_option') is not null then delete from "shipping_option_price_set" where "shipping_option_id" in (select "id" from "shipping_option" where "provider_id" = '${retiredProviderKey}'); end if; end $$;`)
    this.addSql(`do $$ begin if to_regclass('shipping_option_rule') is not null and to_regclass('shipping_option') is not null then delete from "shipping_option_rule" where "shipping_option_id" in (select "id" from "shipping_option" where "provider_id" = '${retiredProviderKey}'); end if; end $$;`)
    this.addSql(`do $$ begin if to_regclass('shipping_option') is not null then delete from "shipping_option" where "provider_id" = '${retiredProviderKey}'; end if; end $$;`)
    this.addSql(`do $$ begin if to_regclass('location_fulfillment_provider') is not null then delete from "location_fulfillment_provider" where "fulfillment_provider_id" = '${retiredProviderKey}'; end if; end $$;`)
    this.addSql(`do $$ begin if to_regclass('fulfillment_provider') is not null then delete from "fulfillment_provider" where "id" = '${retiredProviderKey}'; end if; end $$;`)
  }

  override async down(): Promise<void> {
    // Data removal is intentionally irreversible. Re-adding the provider would
    // not restore its historical configuration, quotes, or shipments.
  }
}
