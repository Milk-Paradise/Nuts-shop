import { model } from "@medusajs/framework/utils"

const ShippingReturnRequest = model.define("shipping_return_request", {
  id: model.id().primaryKey(),
  order_id: model.text(),
  provider_key: model.text(),
  status: model.enum(["pending", "approved", "rejected"]).default("pending"),
  reason: model.text().nullable(),
  previous_delivery_status: model.enum([
    "placed",
    "preparing",
    "in_transit",
    "delivered",
    "cancelled",
    "return_in_progress",
  ]).nullable(),
  return_provider_shipment_id: model.text().nullable(),
  return_tracking_number: model.text().nullable(),
  return_delivery_status: model.enum([
    "placed",
    "preparing",
    "in_transit",
    "delivered",
    "cancelled",
    "return_in_progress",
  ]).nullable(),
  return_status_event_at: model.dateTime().nullable(),
})
.indexes([
  {
    name: "IDX_shipping_return_request_order_pending_unique",
    on: ["order_id"],
    unique: true,
    where: "deleted_at IS NULL AND status = 'pending'",
  },
  {
    name: "IDX_shipping_return_request_provider_shipment",
    on: ["return_provider_shipment_id"],
    where: "deleted_at IS NULL",
  },
])

export default ShippingReturnRequest
