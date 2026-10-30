import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createHash } from "node:crypto"

import type { CmsHomepage } from "./cms-content"
import { findPublicCategoryById } from "./public-category"

type Target = { type: "product" | "category" | "collection" | "external_url"; medusaId?: string | null }
type Query = { graph(input: Record<string, unknown>): Promise<{ data: any[] }> }

export async function resolveValidCommerceTargets(
  container: MedusaContainer,
  targets: Target[]
): Promise<Set<string>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as Query
  const valid = new Set<string>()
  for (const target of targets) {
    if (target.type === "external_url") continue
    const id = target.medusaId
    if (!id) continue
    if (target.type === "category") {
      if (await findPublicCategoryById(container, id)) {
        valid.add(`${target.type}:${id}`)
      }
      continue
    }

    const config = target.type === "product"
      ? { entity: "product", fields: ["id", "status"], valid: (row: any) => row.status === "published" }
      : { entity: "product_collection", fields: ["id"], valid: () => true }
    const { data } = await query.graph({ entity: config.entity, fields: config.fields, filters: { id } })
    if (data[0] && config.valid(data[0])) valid.add(`${target.type}:${id}`)
  }
  return valid
}

export async function filterInvalidCmsBanners(
  container: MedusaContainer,
  content: CmsHomepage
): Promise<CmsHomepage> {
  const bannerSections = content.sections.filter(
    (section: any) => section.__component === "sections.promo-banners"
  ) as any[]
  const targets = bannerSections.flatMap((section) =>
    section.banners.filter((banner: any) => banner.enabled).map((banner: any) => banner.target)
  )
  const valid = await resolveValidCommerceTargets(container, targets)
  const sections = content.sections.flatMap((section: any) => {
    if (section.__component !== "sections.promo-banners") return [section]
    const banners = section.banners.filter((banner: any) => {
      if (!banner.enabled) return false
      const target = banner.target as Target
      return target.type === "external_url" || valid.has(`${target.type}:${target.medusaId}`)
    })
    return banners.length ? [{ ...section, banners }] : []
  })
  const targetState = createHash("sha256")
    .update(JSON.stringify([...valid].sort()))
    .digest("hex")
  return {
    ...content,
    revision: `${content.revision}|targets:${targetState}`,
    sourceUpdatedAt: new Date().toISOString(),
    sections,
  } as CmsHomepage
}
