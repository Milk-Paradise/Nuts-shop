import { Module } from "@medusajs/framework/utils"

import ErpIntegrationRegistryService from "./service"

export type ErpIntegrationRegistryModuleService = ErpIntegrationRegistryService

export const ERP_INTEGRATION_REGISTRY_MODULE = "erpIntegrationRegistry"

export default Module(ERP_INTEGRATION_REGISTRY_MODULE, {
  service: ErpIntegrationRegistryService,
})
