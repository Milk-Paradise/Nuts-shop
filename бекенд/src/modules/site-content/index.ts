import { Module } from "@medusajs/framework/utils"

import SiteContentModuleService from "./service"
import { SITE_CONTENT_MODULE } from "./module-key"

export { SITE_CONTENT_MODULE }

export default Module(SITE_CONTENT_MODULE, {
  service: SiteContentModuleService,
})
