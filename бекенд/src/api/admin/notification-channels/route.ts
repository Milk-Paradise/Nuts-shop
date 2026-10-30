import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { NOTIFICATION_DOMAIN_MODULE } from "../../../modules/notification-domain"
import type NotificationDomainModuleService from "../../../modules/notification-domain/service"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const service = req.scope.resolve<NotificationDomainModuleService>(
    NOTIFICATION_DOMAIN_MODULE
  )
  res.json({ channels: await service.listAdminChannelSettings() })
}
