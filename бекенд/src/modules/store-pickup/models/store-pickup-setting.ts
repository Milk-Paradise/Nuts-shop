import { model } from "@medusajs/framework/utils"

const StorePickupSetting = model.define("store_pickup_setting", {
  id: model.id().primaryKey(),
  address: model.text().default(""),
  hours: model.text().default(""),
  is_enabled: model.boolean().default(false),
})

export default StorePickupSetting

