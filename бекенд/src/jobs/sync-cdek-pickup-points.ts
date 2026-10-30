import type { MedusaContainer } from "@medusajs/framework/types"

import { syncCdekPickupPointsWorkflow } from "../workflows/sync-cdek-pickup-points"

export default async function syncCdekPickupPointsJob(container: MedusaContainer) {
  if (process.env.E2E_RUN === "true") return
  await syncCdekPickupPointsWorkflow(container).run({ input: {} })
}

export const config = {
  name: "sync-cdek-pickup-points-daily",
  schedule: "0 3 * * *",
}
