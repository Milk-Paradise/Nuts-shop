import { model } from "@medusajs/framework/utils"

const ShippingWebhookEvent = model.define("shipping_webhook_event", {
  id: model.id().primaryKey(),
  event_uuid: model.text().unique(),
  provider_key: model.text(),
  event_type: model.text(),
  event_at: model.dateTime(),
  shipment_id: model.text().nullable(),
  applied: model.boolean().default(false),
})

export default ShippingWebhookEvent
