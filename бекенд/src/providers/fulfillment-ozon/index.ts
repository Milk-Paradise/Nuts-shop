import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import OzonFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [OzonFulfillmentService],
})
