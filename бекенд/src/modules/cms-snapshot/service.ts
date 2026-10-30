import { MedusaService } from "@medusajs/framework/utils"

import CmsSnapshot from "./models/cms-snapshot"

class CmsSnapshotModuleService extends MedusaService({ CmsSnapshot }) {}

export default CmsSnapshotModuleService
