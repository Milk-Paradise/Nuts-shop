import { model } from "@medusajs/framework/utils"

const PaymentProviderConfig = model.define("payment_provider_config", {
  id: model.id().primaryKey(),
  provider_id: model.text().unique(),
  shop_id: model.text().nullable(),
  encrypted_secret_key: model.text().nullable(),
  mode: model.enum(["test", "live"]).default("test"),
  is_enabled: model.boolean().default(false),
  created_by_user_id: model.text().nullable(),
  updated_by_user_id: model.text().nullable(),
})

export default PaymentProviderConfig
