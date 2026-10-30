import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import RuntimeYooKassaService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [RuntimeYooKassaService],
})
