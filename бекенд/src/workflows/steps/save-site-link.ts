import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { SITE_CONTENT_MODULE } from "../../modules/site-content/module-key"
import type { SiteLinkKind } from "../../modules/site-content/models/site-link"
import type SiteContentModuleService from "../../modules/site-content/service"

export type SaveSiteLinkStepInput = {
  id?: string
  kind: SiteLinkKind
  label?: string | null
  url: string
}

type Compensation =
  | { action: "delete"; id: string }
  | { action: "restore"; id: string; label: string | null; url: string }

export const saveSiteLinkStep = createStep(
  "save-site-link",
  async (input: SaveSiteLinkStepInput, { container }) => {
    const siteContentService = container.resolve(
      SITE_CONTENT_MODULE
    ) as SiteContentModuleService

    // "reviews" is a singleton link — always update the existing row (if any)
    // instead of accumulating duplicates, regardless of whether an id was
    // supplied by the caller.
    let targetId = input.id

    if (input.kind === "reviews") {
      const [existingReviewsLink] = await siteContentService.listSiteLinks({
        kind: "reviews",
      })
      targetId = existingReviewsLink?.id
    }

    if (targetId) {
      const [previous] = await siteContentService.listSiteLinks({ id: targetId })

      if (!previous) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, "Site link not found")
      }

      const updated = await siteContentService.updateSiteLinks({
        id: targetId,
        label: input.label ?? null,
        url: input.url,
      })

      const compensation: Compensation = {
        action: "restore",
        id: targetId,
        label: previous.label,
        url: previous.url,
      }

      return new StepResponse(updated, compensation)
    }

    const created = await siteContentService.createSiteLinks({
      kind: input.kind,
      label: input.label ?? null,
      url: input.url,
    })

    const compensation: Compensation = { action: "delete", id: created.id }

    return new StepResponse(created, compensation)
  },
  async (compensation: Compensation | undefined, { container }) => {
    if (!compensation) return

    const siteContentService = container.resolve(
      SITE_CONTENT_MODULE
    ) as SiteContentModuleService

    if (compensation.action === "delete") {
      await siteContentService.deleteSiteLinks(compensation.id)
      return
    }

    await siteContentService.updateSiteLinks({
      id: compensation.id,
      label: compensation.label,
      url: compensation.url,
    })
  }
)
