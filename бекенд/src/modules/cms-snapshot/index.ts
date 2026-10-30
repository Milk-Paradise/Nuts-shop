import { Module } from "@medusajs/framework/utils"

import CmsSnapshotModuleService from "./service"

export const CMS_SNAPSHOT_MODULE = "cmsSnapshot"

export default Module(CMS_SNAPSHOT_MODULE, { service: CmsSnapshotModuleService })
