import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { SITE_CONTENT_MODULE } from "../../../modules/site-content/module-key"
import { SITE_TAB_KEYS } from "../../../modules/site-content/models/site-tab"
import type SiteContentModuleService from "../../../modules/site-content/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const siteContentService = req.scope.resolve(
    SITE_CONTENT_MODULE
  ) as SiteContentModuleService

  const [existingTabs, links] = await Promise.all([
    siteContentService.listSiteTabs({ key: [...SITE_TAB_KEYS] }),
    siteContentService.listSiteLinks({}, { order: { rank: "ASC" } }),
  ])

  const tabsByKey = new Map(existingTabs.map((tab) => [tab.key, tab]))
  const tabs = SITE_TAB_KEYS.map((key) => ({
    key,
    content: tabsByKey.get(key)?.content ?? null,
  }))

  return res.status(200).json({ tabs, links })
}
