import type { MedusaContainer } from "@medusajs/framework/types"
import { syncOzonPickupPointsWorkflow } from "../workflows/sync-ozon-pickup-points"

export default async function syncOzonPickupPointsJob(container: MedusaContainer) {
  if (process.env.E2E_RUN === "true") return
  await syncOzonPickupPointsWorkflow(container).run({ input: {} })
}

export const config = {
  name: "sync-ozon-pickup-points-daily",
  schedule: "0 3 * * *",
}
