import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { SITE_CONTENT_MODULE } from "../../modules/site-content/module-key"
import type SiteContentModuleService from "../../modules/site-content/service"
import type { SiteLinkKind } from "../../modules/site-content/models/site-link"

export type DeleteSiteLinkStepInput = { id: string }

type ExistingLink = {
  id: string
  kind: SiteLinkKind
  label: string | null
  url: string
  rank: number
}

export const deleteSiteLinkStep = createStep(
  "delete-site-link",
  async (input: DeleteSiteLinkStepInput, { container }) => {
    const siteContentService = container.resolve(
      SITE_CONTENT_MODULE
    ) as SiteContentModuleService

    const [existing] = await siteContentService.listSiteLinks({ id: input.id })

    if (!existing) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Site link not found")
    }

    await siteContentService.deleteSiteLinks(input.id)

    const compensation: ExistingLink = {
      id: existing.id,
      kind: existing.kind,
      label: existing.label,
      url: existing.url,
      rank: existing.rank,
    }

    return new StepResponse({ id: input.id }, compensation)
  },
  async (compensation: ExistingLink | undefined, { container }) => {
    if (!compensation) return

    const siteContentService = container.resolve(
      SITE_CONTENT_MODULE
    ) as SiteContentModuleService

    await siteContentService.createSiteLinks({
      id: compensation.id,
      kind: compensation.kind,
      label: compensation.label,
      url: compensation.url,
      rank: compensation.rank,
    })
  }
)
