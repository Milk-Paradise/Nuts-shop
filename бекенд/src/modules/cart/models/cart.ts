import { model } from "@medusajs/framework/utils"

// This partial model shares the core cart table, but its entity name must stay
// unique. Naming it "Cart" shadows Medusa's core entity metadata at runtime.
const VersionedCart = model
  .define(
    {
      name: "VersionedCart",
      tableName: "cart",
    },
    {
      id: model.id({ prefix: "cart" }).primaryKey(),
      customer_id: model.text().nullable(),
      version: model.number().default(0),
      guest_owner_hash: model.text().unique().nullable(),
    }
  )
  .indexes([
    {
      name: "IDX_cart_customer_id",
      on: ["customer_id"],
    },
  ])

export default VersionedCart
