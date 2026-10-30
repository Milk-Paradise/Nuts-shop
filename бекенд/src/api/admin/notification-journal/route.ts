import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { NOTIFICATION_DOMAIN_MODULE } from "../../../modules/notification-domain"
import type NotificationDomainModuleService from "../../../modules/notification-domain/service"
import { serializeNotification, type NotificationJournalRecord } from "./serializers"
import type { GetNotificationsQuery } from "./validators"

export async function GET(
  req: MedusaRequest<GetNotificationsQuery>,
  res: MedusaResponse
) {
  const service = req.scope.resolve<NotificationDomainModuleService>(
    NOTIFICATION_DOMAIN_MODULE
  )
  const { q, channel, state, type, show_tests, order_id, limit, offset } =
    req.validatedQuery
  const filters: Record<string, unknown> = {}

  if (channel) filters.channel = channel
  if (state) filters.state = state
  if (type) filters.type = type
  if (!show_tests || order_id) filters.is_test = false
  if (order_id) filters.event_key = { $like: `%:${order_id}%` }
  if (q) {
    filters.$or = [
      { event_key: { $ilike: `%${q}%` } },
      { recipient: { $ilike: `%${q}%` } },
    ]
  }

  const [records, count] = await service.listAndCountNotificationMessages(
    filters as never,
    { take: limit, skip: offset, order: { created_at: "DESC" } }
  )
  const ids = records.map((record) => record.id)
  const attempts = ids.length
    ? await service.listNotificationAttempts(
        { notification_id: ids } as never,
        { order: { attempt_number: "ASC" } }
      )
    : []

  const attemptsByNotification = new Map<string, typeof attempts>()
  for (const attempt of attempts) {
    const current = attemptsByNotification.get(attempt.notification_id) ?? []
    current.push(attempt)
    attemptsByNotification.set(attempt.notification_id, current)
  }

  return res.status(200).json({
    notifications: records.map((record) =>
      serializeNotification(
        record as unknown as NotificationJournalRecord,
        attemptsByNotification.get(record.id) as never
      )
    ),
    count,
    limit,
    offset,
  })
}
