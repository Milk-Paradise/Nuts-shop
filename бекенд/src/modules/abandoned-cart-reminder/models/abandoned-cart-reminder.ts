import { model } from "@medusajs/framework/utils"

// cart_updated_at_at_send is a snapshot of the cart's updated_at at send
// time — comparing against it (rather than re-touching the cart itself,
// which would bump the cart's own updated_at and falsely look like fresh
// customer activity) is how the job tells "cart untouched since last
// reminder" apart from "cart was modified again after the reminder".
const AbandonedCartReminder = model
  .define("abandoned_cart_reminder", {
    id: model.id().primaryKey(),
    cart_id: model.text(),
    sent_at: model.dateTime(),
    cart_updated_at_at_send: model.dateTime(),
  })
  .indexes([
    {
      on: ["cart_id"],
      unique: true,
    },
  ])

export default AbandonedCartReminder
