import { model } from "@medusajs/framework/utils"

export const SITE_TAB_KEYS = [
  "catalog",
  "brands",
  "contacts",
  "about",
  "paint_selection",
  "delivery",
] as const

export type SiteTabKey = (typeof SITE_TAB_KEYS)[number]

const SiteTab = model.define("site_tab", {
  id: model.id().primaryKey(),
  key: model.enum([...SITE_TAB_KEYS]).unique(),
  content: model.text().nullable(),
})

export default SiteTab
