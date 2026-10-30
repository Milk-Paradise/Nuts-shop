import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { MOYSKLAD_INTEGRATION_MODULE } from "../../../../modules/moysklad-integration"
import { MoyskladApiError } from "../../../../modules/moysklad-integration/client"
import { configureMoyskladConnectionWorkflow } from "../../../../workflows/configure-moysklad-connection"
import { serializeMoyskladConnectionConfig, type MoyskladConnectionConfigResponse } from "../serializers"
import type { SaveMoyskladConnectionBody } from "../validators"

type MoyskladConnectionService = {
  getConnectionConfig(): Promise<{ is_active: boolean } | null>
  getConnectionAttentionReason(): Promise<string | null>
}

export async function GET(req: MedusaRequest, res: MedusaResponse<MoyskladConnectionConfigResponse>) {
  const service = req.scope.resolve<MoyskladConnectionService>(MOYSKLAD_INTEGRATION_MODULE)
  const [config, attentionReason] = await Promise.all([
    service.getConnectionConfig(),
    service.getConnectionAttentionReason()
  ])

  return res.status(200).json(serializeMoyskladConnectionConfig(config, attentionReason))
}

export async function POST(req: MedusaRequest<SaveMoyskladConnectionBody>, res: MedusaResponse) {
  try {
    const { result } = await configureMoyskladConnectionWorkflow(req.scope).run({
      input: req.validatedBody
    })

    return res.status(200).json(
      serializeMoyskladConnectionConfig(
        result as {
          is_active: boolean
        }
      )
    )
  } catch (error) {
    if (error instanceof MoyskladApiError) {
      return res.status(error.status ?? 502).json({ message: error.message })
    }

    throw error
  }
}
