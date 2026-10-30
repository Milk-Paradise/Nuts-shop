import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import CdekFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [CdekFulfillmentService],
})
