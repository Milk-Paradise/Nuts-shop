import { MedusaService } from "@medusajs/framework/utils"

import SiteTab from "./models/site-tab"
import SiteLink from "./models/site-link"

class SiteContentModuleService extends MedusaService({
  SiteTab,
  SiteLink,
}) {}

export default SiteContentModuleService
