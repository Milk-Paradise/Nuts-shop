import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  NOTIFICATION_DOMAIN_MODULE,
} from "../../../../modules/notification-domain"
import type NotificationDomainModuleService from "../../../../modules/notification-domain/service"
import {
  disableTelegramBindingWorkflow,
  issueTelegramBindingWorkflow,
} from "../../../../workflows/telegram-binding"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const service = req.scope.resolve<NotificationDomainModuleService>(
    NOTIFICATION_DOMAIN_MODULE
  )
  return res.json({
    telegram: await service.getTelegramBindingStatus(
      req.auth_context.actor_id
    ),
  })
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await issueTelegramBindingWorkflow(req.scope).run({
    input: { account_id: req.auth_context.actor_id },
  })
  return res.status(201).json({ telegram: result })
}

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await disableTelegramBindingWorkflow(req.scope).run({
    input: { account_id: req.auth_context.actor_id },
  })
  return res.json({ telegram: result })
}
