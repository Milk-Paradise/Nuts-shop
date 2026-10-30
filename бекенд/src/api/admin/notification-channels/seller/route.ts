import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { NOTIFICATION_DOMAIN_MODULE } from "../../../../modules/notification-domain"
import type NotificationDomainModuleService from "../../../../modules/notification-domain/service"
import { saveSellerEmailWorkflow } from "../../../../workflows/seller-notification-channels"
import type { AdminSaveSellerEmailBody } from "../validators"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const service = req.scope.resolve<NotificationDomainModuleService>(
    NOTIFICATION_DOMAIN_MODULE
  )
  return res.json({ seller: await service.getSellerChannelSettings() })
}

export async function POST(
  req: AuthenticatedMedusaRequest<AdminSaveSellerEmailBody>,
  res: MedusaResponse
) {
  const { result } = await saveSellerEmailWorkflow(req.scope).run({
    input: req.validatedBody,
  })
  return res.json({ seller: result })
}
