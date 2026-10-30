import { model } from "@medusajs/framework/utils"

const ShippingStorePackage = model.define("shipping_store_package", {
  id: model.id().primaryKey(),
  weight_grams: model.number(),
  length_mm: model.number(),
  width_mm: model.number(),
  height_mm: model.number(),
})

export default ShippingStorePackage
