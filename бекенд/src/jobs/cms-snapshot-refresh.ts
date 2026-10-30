import type { MedusaContainer } from "@medusajs/framework/types"

import {
  CMS_HOMEPAGE_SNAPSHOT_KEY,
  CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY,
  refreshCmsSnapshot,
} from "../lib/cms-snapshot"

export default async function cmsSnapshotRefreshJob(container: MedusaContainer) {
  if (process.env.E2E_RUN === "true") return
  const logger = container.resolve("logger")
  for (const key of [CMS_HOMEPAGE_SNAPSHOT_KEY, CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY]) {
    try {
      await refreshCmsSnapshot(container, key)
    } catch (error) {
      // CMS snapshot refresh failures remain technical log incidents until CAT-93
      // defines a notification-journal record, event key, channel, order link, and UI.
      logger.error(`CMS snapshot '${key}' refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export const config = { name: "cms-snapshot-refresh", schedule: "* * * * *" }
