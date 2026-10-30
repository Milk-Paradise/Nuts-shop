import { model } from "@medusajs/framework/utils"

const ShippingShipment = model.define("shipping_shipment", {
  id: model.id().primaryKey(),
  order_id: model.text(),
  business_action_id: model.text().nullable(),
  direction: model.enum(["forward", "return"]).default("forward"),
  destination_key: model.text().nullable(),
  provider_key: model.text(),
  status: model.enum(["creating", "created", "failed"]).default("creating"),
  provider_shipment_id: model.text().nullable(),
  tracking_number: model.text().nullable(),
  simplified_status: model.enum([
    "placed",
    "preparing",
    "in_transit",
    "delivered",
    "cancelled",
    "return_in_progress",
  ]).default("placed"),
  status_event_at: model.dateTime().nullable(),
  status_event_uuid: model.text().nullable(),
  label_request_uuid: model.text().nullable(),
  label_url: model.text().nullable(),
  label_event_uuid: model.text().nullable(),
  error_message: model.text().nullable(),
  reconciliation_required: model.boolean().default(false),
})
.indexes([
  {
    name: "IDX_shipping_shipment_order_provider_direction_unique",
    on: ["order_id", "provider_key", "direction"],
    unique: true,
    where: "deleted_at IS NULL",
  },
  {
    name: "IDX_shipping_shipment_action_direction_destination_unique",
    on: ["business_action_id", "direction", "destination_key"],
    unique: true,
    where: "deleted_at IS NULL AND business_action_id IS NOT NULL AND destination_key IS NOT NULL",
  },
  {
    name: "IDX_shipping_shipment_provider_shipment",
    on: ["provider_shipment_id"],
    where: "deleted_at IS NULL",
  },
  {
    name: "IDX_shipping_shipment_label_request",
    on: ["label_request_uuid"],
    where: "deleted_at IS NULL",
  },
])

export default ShippingShipment
