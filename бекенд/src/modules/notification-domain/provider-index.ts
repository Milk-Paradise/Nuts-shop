import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import NotificationDomainProviderService from "./provider"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [NotificationDomainProviderService],
})
