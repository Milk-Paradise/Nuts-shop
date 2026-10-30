import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { processOzonWebhook } from "../../../../workflows/process-ozon-webhook"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8")
  const headers = req.headers as Record<string, string | string[] | undefined>
  const result = await processOzonWebhook(req.scope, rawBody, headers, req.body)
  res.status(200).json({ result })
}
