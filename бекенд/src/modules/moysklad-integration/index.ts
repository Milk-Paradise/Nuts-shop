import { Module } from "@medusajs/framework/utils"

import MoyskladIntegrationService from "./service"

export const MOYSKLAD_INTEGRATION_MODULE = "moyskladIntegration"

export default Module(MOYSKLAD_INTEGRATION_MODULE, {
  service: MoyskladIntegrationService,
})
