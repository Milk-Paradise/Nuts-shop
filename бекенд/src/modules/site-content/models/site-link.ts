import { model } from "@medusajs/framework/utils"

export const SITE_LINK_KINDS = ["social", "reviews"] as const

export type SiteLinkKind = (typeof SITE_LINK_KINDS)[number]

const SiteLink = model.define("site_link", {
  id: model.id().primaryKey(),
  kind: model.enum([...SITE_LINK_KINDS]),
  // Название соцсети (например "VK"); не используется для kind="reviews".
  label: model.text().nullable(),
  url: model.text(),
  rank: model.number().default(0),
})

export default SiteLink
