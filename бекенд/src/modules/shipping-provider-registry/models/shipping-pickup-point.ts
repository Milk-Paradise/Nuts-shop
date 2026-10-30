import { model } from "@medusajs/framework/utils"

const ShippingPickupPoint = model.define("shipping_pickup_point", {
  id: model.id().primaryKey(),
  provider_key: model.text(),
  external_id: model.text(),
  name: model.text(),
  city: model.text(),
  city_code: model.number().nullable(),
  address: model.text(),
  lat: model.float().nullable(),
  lng: model.float().nullable(),
  schedule: model.text().nullable(),
  point_type: model.text().nullable(),
})

export default ShippingPickupPoint
