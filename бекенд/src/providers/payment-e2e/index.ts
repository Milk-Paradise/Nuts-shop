import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import E2EPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [E2EPaymentProviderService],
})
