import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  disconnectSellerTelegramWorkflow,
  issueSellerTelegramBindingWorkflow,
} from "../../../../../workflows/seller-notification-channels"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await issueSellerTelegramBindingWorkflow(req.scope).run()
  return res.status(201).json({ telegram: result })
}

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await disconnectSellerTelegramWorkflow(req.scope).run()
  return res.json({ seller: result })
}
