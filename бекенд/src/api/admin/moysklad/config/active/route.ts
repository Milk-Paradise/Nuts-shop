import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { serializeMoyskladConnectionConfig, type MoyskladConnectionConfigResponse } from "../../serializers"
import type { SetMoyskladConnectionActivityBody } from "../../validators"
import { MOYSKLAD_INTEGRATION_MODULE } from "../../../../../modules/moysklad-integration"
import { setMoyskladConnectionActivityWorkflow } from "../../../../../workflows/set-moysklad-connection-activity"

type MoyskladConnectionService = {
  getConnectionAttentionReason(): Promise<string | null>
}

type MoyskladConnectionConfig = {
  is_active: boolean
  stock_sync_last_error?: string | null
  stock_sync_last_attempt_at?: Date | string | null
  stock_sync_last_success_at?: Date | string | null
  stock_sync_unmatched?: unknown
}

export async function POST(
  req: MedusaRequest<SetMoyskladConnectionActivityBody>,
  res: MedusaResponse<MoyskladConnectionConfigResponse>
) {
  const { result: config } = await setMoyskladConnectionActivityWorkflow(
    req.scope
  ).run({
    input: { isActive: req.validatedBody.is_active },
  }) as { result: MoyskladConnectionConfig | null }
  const service = req.scope.resolve<MoyskladConnectionService>(
    MOYSKLAD_INTEGRATION_MODULE
  )
  const attentionReason = await service.getConnectionAttentionReason()

  return res.status(200).json(serializeMoyskladConnectionConfig(config, attentionReason))
}
