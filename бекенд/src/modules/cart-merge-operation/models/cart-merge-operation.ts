import { model } from "@medusajs/framework/utils"

const CartMergeOperation = model
  .define("cart_merge_operation", {
    id: model.id({ prefix: "cmop" }).primaryKey(),
    guest_cart_id: model.text().unique(),
    customer_id: model.text(),
    result_cart_id: model.text(),
    state: model.enum(["refresh_pending", "completed"]).default("refresh_pending"),
  })

export default CartMergeOperation
