import { Module } from "@medusajs/framework/utils"

import NotificationDomainModuleService from "./service"

export const NOTIFICATION_DOMAIN_MODULE = "notificationDomain"

export * from "./delivery-executor"
export * from "./delivery-adapter-registry"
export * from "./delivery-policy"

export default Module(NOTIFICATION_DOMAIN_MODULE, {
  service: NotificationDomainModuleService,
})
