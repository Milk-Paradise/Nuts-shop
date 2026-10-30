import { model } from "@medusajs/framework/utils"

const ErpIntegration = model.define("erp_integration", {
  id: model.id().primaryKey(),
  integration_key: model.text(),
  display_name: model.text(),
  is_active: model.boolean().default(false),
})

export default ErpIntegration
