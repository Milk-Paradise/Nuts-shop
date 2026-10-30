import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { MOYSKLAD_INTEGRATION_MODULE } from "../../../../modules/moysklad-integration"
import type MoyskladIntegrationService from "../../../../modules/moysklad-integration/service"
import type { GetMoyskladOrderSyncsQuery } from "../validators"

type MoyskladOrderSyncResponse = {
  id: string
  order_id: string
  status: "pending" | "syncing" | "synced" | "error"
  last_error: string | null
  attempts: number
}

export async function GET(
  req: MedusaRequest<GetMoyskladOrderSyncsQuery>,
  res: MedusaResponse<{ order_syncs: MoyskladOrderSyncResponse[] }>
) {
  const service = req.scope.resolve<MoyskladIntegrationService>(
    MOYSKLAD_INTEGRATION_MODULE
  )
  const orderSyncs = await service.listMoyskladOrderSyncs(
    req.validatedQuery.status ? { status: req.validatedQuery.status } : {},
    { take: 50, order: { updated_at: "DESC" } }
  )

  return res.status(200).json({ order_syncs: orderSyncs as MoyskladOrderSyncResponse[] })
}
