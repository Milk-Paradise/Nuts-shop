import { createHmac, timingSafeEqual } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"

import {
  fetchConsistentPublishedHomepage,
  fetchConsistentPublishedNotificationTemplates,
  type CmsHomepage,
  type NotificationTemplatesSnapshot,
} from "./cms-content"
import { CMS_SNAPSHOT_MODULE } from "../modules/cms-snapshot"
import type CmsSnapshotModuleService from "../modules/cms-snapshot/service"
import { filterInvalidCmsBanners } from "./cms-commerce-targets"

export const CMS_HOMEPAGE_SNAPSHOT_KEY = "homepage"
export const CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY = "notification-templates"

type CmsSnapshotContent = {
  revision: string
  sourceUpdatedAt: string
}

type SnapshotService = {
  listCmsSnapshots(filters: Record<string, unknown>): Promise<any[]>
  updateCmsSnapshots(input: Record<string, unknown>): Promise<any>
  createCmsSnapshots(input: Record<string, unknown>): Promise<any>
}

export async function persistCmsSnapshot<TContent extends CmsSnapshotContent>(
  service: SnapshotService,
  key: string,
  content: TContent,
  retry = true
): Promise<any> {
  const [existing] = await service.listCmsSnapshots({ key })
  if (existing?.revision === content.revision) return existing
  const sourceUpdatedAt = new Date(content.sourceUpdatedAt)
  if (existing) {
    const timeOrder = new Date(existing.content_updated_at).getTime() - sourceUpdatedAt.getTime()
    if (timeOrder > 0 || (timeOrder === 0 && existing.revision.localeCompare(content.revision) >= 0)) {
      return existing
    }
  }
  try {
    if (existing) {
      return await service.updateCmsSnapshots({
        selector: {
          id: existing.id,
          revision: existing.revision,
          content_updated_at: { $lte: sourceUpdatedAt },
        },
        data: { revision: content.revision, payload: content, content_updated_at: sourceUpdatedAt },
      } as any)
    }
    return await service.createCmsSnapshots({
      key,
      revision: content.revision,
      payload: content,
      content_updated_at: sourceUpdatedAt,
    })
  } catch (error) {
    if (!retry) throw error
    return persistCmsSnapshot(service, key, content, false)
  }
}

export async function refreshCmsSnapshot(container: MedusaContainer, key: string) {
  let content: CmsHomepage | NotificationTemplatesSnapshot
  if (key === CMS_HOMEPAGE_SNAPSHOT_KEY) {
    const fetched = await fetchConsistentPublishedHomepage()
    content = await filterInvalidCmsBanners(container, fetched)
  } else if (key === CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY) {
    content = await fetchConsistentPublishedNotificationTemplates()
  } else {
    throw new Error(`Unsupported CMS snapshot key '${key}'`)
  }
  const service = container.resolve(CMS_SNAPSHOT_MODULE) as CmsSnapshotModuleService
  return persistCmsSnapshot(service as unknown as SnapshotService, key, content)
}

export async function readCmsSnapshot<TContent>(
  container: MedusaContainer,
  key: string
): Promise<TContent | null> {
  const service = container.resolve(CMS_SNAPSHOT_MODULE) as CmsSnapshotModuleService
  const [snapshot] = await service.listCmsSnapshots({ key })
  return (snapshot?.payload as TContent | undefined) ?? null
}

export function cmsWebhookSignature(body: string, timestamp: string, secret: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
}

export function verifyCmsWebhook(body: string, timestamp: string, signature: string, secret: string, now = Date.now()) {
  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > 5 * 60_000) return false
  const expected = Buffer.from(cmsWebhookSignature(body, timestamp, secret), "hex")
  const supplied = Buffer.from(signature, "hex")
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}
