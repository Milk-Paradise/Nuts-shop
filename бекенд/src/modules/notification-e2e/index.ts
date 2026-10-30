import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import E2ENotificationService from "./service"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [E2ENotificationService],
})
