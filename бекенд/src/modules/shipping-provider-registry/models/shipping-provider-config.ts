import { model } from "@medusajs/framework/utils"

const ShippingProviderConfig = model.define("shipping_provider_config", {
  id: model.id().primaryKey(),
  provider_key: model.text().unique(),
  encrypted_credentials: model.text().nullable(),
  configuration: model.json().default({}),
})

export default ShippingProviderConfig
