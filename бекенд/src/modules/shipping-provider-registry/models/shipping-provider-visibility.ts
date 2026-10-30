import { model } from "@medusajs/framework/utils"

const ShippingProviderVisibility = model.define("shipping_provider_visibility", {
  id: model.id().primaryKey(),
  provider_key: model.text().unique(),
  is_visible: model.boolean().default(false),
})

export default ShippingProviderVisibility
