import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  getNotificationDeliveryAdapter,
  type DeliveryChannel,
} from "../modules/notification-domain/delivery-adapter-registry"
import {
  NotificationDeliveryExecutor,
  isDeliveryIncidentLogged,
  type NotificationForDelivery,
} from "../modules/notification-domain/delivery-executor"
import { DELIVERY_WINDOW_MS } from "../modules/notification-domain/delivery-policy"
import { NOTIFICATION_DOMAIN_MODULE } from "../modules/notification-domain"
import type NotificationDomainModuleService from "../modules/notification-domain/service"

const PAGE_SIZE = 100
export const NOTIFICATION_ATTEMPT_LEASE_MS = 5 * 60 * 1000

type AttemptRecord = { id: string }

async function listAllNotifications(
  service: NotificationDomainModuleService,
  filters: Record<string, unknown>
) {
  const notifications: NotificationForDelivery[] = []
  let skip = 0

  while (true) {
    const page = (await service.listNotificationMessages(filters, {
      take: PAGE_SIZE,
      skip,
    } as never)) as NotificationForDelivery[]
    notifications.push(...page)
    if (page.length < PAGE_SIZE) return notifications
    skip += PAGE_SIZE
  }
}

async function logSweepIncident(
  service: NotificationDomainModuleService,
  logger: { error(message: string): void },
  notificationId: string,
  error: unknown
) {
  let attemptId: string | null = null
  try {
    const [latest] = (await service.listNotificationAttempts(
      { notification_id: notificationId },
      { order: { attempt_number: "DESC" }, take: 1 }
    )) as AttemptRecord[]
    attemptId = latest?.id ?? null
  } catch {
    // Logging must not stop the sweep when diagnostics cannot be loaded.
  }

  try {
    logger.error(
      JSON.stringify({
        incident: true,
        kind: "notification_delivery_sweep_failure",
        notification_id: notificationId,
        attempt_id: attemptId,
        error_name: error instanceof Error ? error.name : "UnknownError",
      })
    )
  } catch {
    // Incident reporting must not stop other notifications.
  }
}

export async function sweepNotificationDeliveries(
  container: MedusaContainer,
  now = new Date()
) {
  const service = container.resolve(
    NOTIFICATION_DOMAIN_MODULE
  ) as NotificationDomainModuleService
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const executor = new NotificationDeliveryExecutor(service, logger, () => now)
  const deadline = new Date(now.getTime() - DELIVERY_WINDOW_MS)
  let exhausted = 0
  let executed = 0

  for (const state of ["processing", "retry_pending"] as const) {
    const expired = await listAllNotifications(service, {
      state,
      is_test: false,
      created_at: { $lte: deadline },
    })

    for (const notification of expired) {
      try {
        if (state === "processing") {
          const exhaustedProcessing = await service.exhaustProcessingNotificationIfLeaseExpired(
            notification.id,
            new Date(now.getTime() - NOTIFICATION_ATTEMPT_LEASE_MS)
          )
          if (exhaustedProcessing) exhausted += 1
        } else {
          await service.transitionNotification(
            notification.id,
            state,
            "retries_exhausted",
            "delivery window exhausted",
            null
          )
          exhausted += 1
        }
      } catch (error) {
        await logSweepIncident(service, logger, notification.id, error)
      }
    }
  }

  const due = await listAllNotifications(service, {
    state: "retry_pending",
    is_test: false,
    next_attempt_at: { $lte: now },
  })

  // Каналы обрабатываются параллельно, внутри канала — по очереди:
  // зависший адаптер одного канала не задерживает повторы другого.
  const dueByChannel = new Map<DeliveryChannel, typeof due>()
  for (const notification of due) {
    if (notification.channel === "none") continue
    const channel = notification.channel as DeliveryChannel
    dueByChannel.set(channel, [...(dueByChannel.get(channel) ?? []), notification])
  }

  await Promise.all(
    [...dueByChannel].map(async ([channel, notifications]) => {
      const adapter = getNotificationDeliveryAdapter(channel)
      if (!adapter) return

      for (const notification of notifications) {
        try {
          await executor.execute(notification.id, adapter)
          executed += 1
        } catch (error) {
          if (!isDeliveryIncidentLogged(error)) {
            await logSweepIncident(service, logger, notification.id, error)
          }
        }
      }
    })
  )

  return { exhausted, executed }
}

export default async function notificationDeliverySweepJob(
  container: MedusaContainer
) {
  if (process.env.E2E_RUN === "true") return
  await sweepNotificationDeliveries(container)
}

export const config = {
  name: "notification-delivery-sweep",
  schedule: "* * * * *",
}
