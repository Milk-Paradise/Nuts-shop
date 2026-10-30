import { Module } from "@medusajs/framework/utils"

import { STORE_PICKUP_MODULE } from "./module-key"
import StorePickupModuleService from "./service"

export { STORE_PICKUP_MODULE }

export default Module(STORE_PICKUP_MODULE, {
  service: StorePickupModuleService,
})

