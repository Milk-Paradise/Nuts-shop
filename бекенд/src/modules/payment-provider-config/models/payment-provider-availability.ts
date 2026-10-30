import { model } from "@medusajs/framework/utils"

const PaymentProviderAvailability = model
  .define("payment_provider_availability", {
    id: model.id().primaryKey(),
    provider_id: model.text(),
    store_id: model.text(),
    region_id: model.text(),
    is_enabled: model.boolean().default(false),
  })
  .indexes([
    {
      name: "IDX_payment_provider_availability_scope_unique",
      on: ["provider_id", "store_id", "region_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default PaymentProviderAvailability
