import { model } from "@medusajs/framework/utils"

const OrderFixation = model
  .define("order_fixation", {
    id: model.id().primaryKey(),
    cart_id: model.text(),
    request_fingerprint: model.text(),
    order_id: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_order_fixation_cart_unique",
      on: ["cart_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_order_fixation_order_unique",
      on: ["order_id"],
      unique: true,
      where: "deleted_at IS NULL AND order_id IS NOT NULL",
    },
  ])

export default OrderFixation
