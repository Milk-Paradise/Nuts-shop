import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import SmtpNotificationService from "./service"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [SmtpNotificationService],
})
