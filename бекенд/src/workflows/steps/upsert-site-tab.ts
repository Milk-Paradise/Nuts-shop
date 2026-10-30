import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import sanitizeHtml from "sanitize-html"

import { SITE_CONTENT_MODULE } from "../../modules/site-content/module-key"
import { SITE_TAB_KEYS, type SiteTabKey } from "../../modules/site-content/models/site-tab"
import type SiteContentModuleService from "../../modules/site-content/service"

export type UpsertSiteTabStepInput = {
  key: SiteTabKey
  content: string | null
}

type Compensation =
  | { id: string; wasCreated: true }
  | { id: string; wasCreated: false; previousContent: string | null }

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: ["b", "strong", "i", "em", "ul", "ol", "li", "a", "p", "br"],
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  allowedSchemes: ["http", "https", "mailto"],
}

export const upsertSiteTabStep = createStep(
  "upsert-site-tab",
  async (input: UpsertSiteTabStepInput, { container }) => {
    if (!(SITE_TAB_KEYS as readonly string[]).includes(input.key)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown tab key: ${input.key}`
      )
    }

    const siteContentService = container.resolve(
      SITE_CONTENT_MODULE
    ) as SiteContentModuleService

    const sanitizedContent =
      input.content === null
        ? null
        : sanitizeHtml(input.content, sanitizeOptions).trim() || null

    const [existing] = await siteContentService.listSiteTabs({ key: input.key })

    if (existing) {
      const updated = await siteContentService.updateSiteTabs({
        id: existing.id,
        content: sanitizedContent,
      })

      const compensation: Compensation = {
        id: existing.id,
        wasCreated: false,
        previousContent: existing.content,
      }

      return new StepResponse(updated, compensation)
    }

    const created = await siteContentService.createSiteTabs({
      key: input.key,
      content: sanitizedContent,
    })

    const compensation: Compensation = { id: created.id, wasCreated: true }

    return new StepResponse(created, compensation)
  },
  async (compensation: Compensation | undefined, { container }) => {
    if (!compensation) return

    const siteContentService = container.resolve(
      SITE_CONTENT_MODULE
    ) as SiteContentModuleService

    if (compensation.wasCreated) {
      await siteContentService.deleteSiteTabs(compensation.id)
      return
    }

    await siteContentService.updateSiteTabs({
      id: compensation.id,
      content: compensation.previousContent,
    })
  }
)
