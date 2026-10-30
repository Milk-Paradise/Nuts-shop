import { MedusaService } from "@medusajs/framework/utils"

import StorePickupSetting from "./models/store-pickup-setting"

class StorePickupModuleService extends MedusaService({
  StorePickupSetting,
}) {}

export default StorePickupModuleService

