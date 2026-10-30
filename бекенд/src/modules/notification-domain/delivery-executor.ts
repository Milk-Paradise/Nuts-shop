import type NotificationDomainModuleService from "./service"
import type { NotificationChannelSettingRecord } from "./channel-settings"
import {
  MAX_DELIVERY_ATTEMPTS,
  NOTIFICATION_DELIVERY_LEASE_MS,
  deliveryDeadline,
  nextRetryAt,
  shouldRetryUnknown,
} from "./delivery-policy"
import type { NotificationState } from "./state-machine"

export type DeliveryClassification =
  | "success"
  | "temporary_failure"
  | "permanent_failure"
  | "unknown"

export type DeliveryResult = {
  classification: DeliveryClassification
  reason?: string | null
  external_id?: string | null
  channel_setting_version_id?: string | null
  safe_diagnostics?: Record<string, unknown>
}

export type NotificationForDelivery = {
  id: string
  type: string
  recipient: string
  channel: "email" | "telegram" | "sms" | "none"
  state: NotificationState
  content: Record<string, unknown>
  is_test?: boolean
  created_at: Date | string
  next_attempt_at?: Date | string | null
  lease_token?: string | null
  lease_expires_at?: Date | string | null
}

type AdapterInput = {
  notification: NotificationForDelivery
  attempt_number: number
  external_id: string
}

type BaseDeliveryAdapter = {
  deliver(input: AdapterInput): Promise<DeliveryResult>
}

export type NonSmsDeliveryAdapter = BaseDeliveryAdapter & {
  channel: "email" | "telegram" | "none"
  reconcileUnknown?: never
}

export type SmsDeliveryAdapter = BaseDeliveryAdapter & {
  channel: "sms"
  reconcileUnknown(input: AdapterInput): Promise<DeliveryResult>
}

export type DeliveryAdapter = NonSmsDeliveryAdapter | SmsDeliveryAdapter

export type IncidentLogger = {
  error(message: string): void
}

const INCIDENT_LOGGED = Symbol("notification_delivery_incident_logged")

type IncidentMarkedError = Error & { [INCIDENT_LOGGED]?: true }

export function isDeliveryIncidentLogged(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as IncidentMarkedError)[INCIDENT_LOGGED]
  )
}

type DeliveryService = Pick<
  NotificationDomainModuleService,
  | "retrieveNotificationMessage"
  | "listNotificationAttempts"
  | "createNotificationAttempts"
  | "updateNotificationAttempts"
  | "transitionNotification"
  | "claimNotificationDeliveryLease"
  | "renewNotificationDeliveryLease"
  | "listNotificationChannelSettings"
  | "reserveSmsDailyLimit"
>

export const SMS_DAILY_LIMIT_REASON = "лимит"
export const DEFAULT_SMS_DAILY_LIMIT = 100

export function calendarDateInTimezone(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

type TerminalDeliveryStatus =
  | "completed"
  | "retry_pending"
  | "retries_exhausted"
  | "permanently_rejected"
  | "outcome_unknown"

export type ExecutionOutcome =
  | { status: TerminalDeliveryStatus; attempt_id?: string }
  | { status: "not_due" | "already_finished" | "claim_lost" }

function errorDiagnostics(error: unknown) {
  return {
    error_name: error instanceof Error ? error.name : "UnknownError",
  }
}

function deliveryExternalId(
  notification: NotificationForDelivery,
  attemptNumber: number
) {
  return notification.channel === "sms"
    ? notification.id
    : `${notification.id}:${attemptNumber}`
}

function isSmsDeliveryAdapter(
  adapter: DeliveryAdapter
): adapter is SmsDeliveryAdapter {
  return adapter.channel === "sms"
}

async function reconcileSmsUnknown(
  adapter: DeliveryAdapter,
  notification: NotificationForDelivery,
  attemptNumber: number,
  externalId: string,
  result: DeliveryResult
): Promise<DeliveryResult> {
  if (
    notification.channel !== "sms" ||
    result.classification !== "unknown" ||
    !isSmsDeliveryAdapter(adapter)
  ) {
    return result
  }

  try {
    const reconciled = await adapter.reconcileUnknown({
      notification,
      attempt_number: attemptNumber,
      external_id: externalId,
    })
    return { ...reconciled, external_id: externalId }
  } catch (error) {
    return {
      classification: "unknown",
      external_id: externalId,
      safe_diagnostics: errorDiagnostics(error),
    }
  }
}

export class NotificationDeliveryExecutor {
  constructor(
    private readonly service: DeliveryService,
    private readonly logger: IncidentLogger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    notificationId: string,
    adapter: DeliveryAdapter
  ): Promise<ExecutionOutcome> {
    const incidentContext: {
      attemptId: string | null
      attemptNumber: number | null
      alreadyLogged: boolean
    } = { attemptId: null, attemptNumber: null, alreadyLogged: false }

    try {
      return await this.executeClaimed(notificationId, adapter, incidentContext)
    } catch (error) {
      if (!incidentContext.alreadyLogged) {
        this.logTechnicalIncident(notificationId, incidentContext, error)
      }
      const markedError =
        error instanceof Error ? error : new Error("Notification delivery failed")
      Object.assign(markedError, { [INCIDENT_LOGGED]: true })
      throw markedError
    }
  }

  private async executeClaimed(
    notificationId: string,
    adapter: DeliveryAdapter,
    incidentContext: {
      attemptId: string | null
      attemptNumber: number | null
      alreadyLogged: boolean
    }
  ): Promise<ExecutionOutcome> {
    let notification = (await this.service.retrieveNotificationMessage(
      notificationId
    )) as NotificationForDelivery
    const now = this.now()
    const isRetryClaim = notification.state === "retry_pending"

    if (isRetryClaim) {
      if (
        notification.next_attempt_at &&
        new Date(notification.next_attempt_at) > now
      ) {
        return { status: "not_due" }
      }

      try {
        notification = (await this.service.transitionNotification(
          notification.id,
          "retry_pending",
          "processing",
          null,
          null
        )) as NotificationForDelivery
      } catch (error) {
        const current = (await this.service.retrieveNotificationMessage(
          notification.id
        )) as NotificationForDelivery
        if (current.state !== "retry_pending") return { status: "claim_lost" }
        throw error
      }
    } else if (notification.state !== "processing") {
      return { status: "already_finished" }
    }

    const leaseToken = await this.service.claimNotificationDeliveryLease(
      notification.id,
      now
    )
    if (!leaseToken) {
      return { status: "claim_lost" }
    }

    const stopHeartbeat = this.startLeaseHeartbeat(notification.id, leaseToken)
    try {
      const attempts = await this.service.listNotificationAttempts(
        { notification_id: notification.id },
        { order: { attempt_number: "ASC" } }
      )
      const attemptNumber = isRetryClaim ? attempts.length + 1 : 1
      incidentContext.attemptNumber = attemptNumber

    if (
      attemptNumber > MAX_DELIVERY_ATTEMPTS ||
      now >= deliveryDeadline(notification.created_at)
    ) {
      await this.service.transitionNotification(
        notification.id,
        "processing",
        "retries_exhausted",
        "delivery window exhausted",
        null,
        leaseToken
      )
      return { status: "retries_exhausted" }
    }

    const externalId = deliveryExternalId(notification, attemptNumber)
    let attempt: { id: string }
    try {
      attempt = await this.service.createNotificationAttempts({
        notification_id: notification.id,
        attempt_number: attemptNumber,
        attempted_at: now,
        channel_setting_version_id: null,
        external_id: externalId,
        result: "in_flight",
        safe_diagnostics: {},
      })
      incidentContext.attemptId = attempt.id
    } catch (error) {
      const claimed = await this.service.listNotificationAttempts({
        notification_id: notification.id,
        attempt_number: attemptNumber,
      })
      if (claimed.length) return { status: "claim_lost" }
      throw error
    }

    // Test SMS reserves its unit before its journal row is created. Production
    // SMS reserves after the attempt claim, so concurrent executors cannot burn
    // multiple units for the same notification before one of them wins.
    // Единица лимита — одно уведомление: резерв только на первой попытке,
    // повторы того же SMS лимит не списывают и по лимиту не отклоняются.
    if (notification.channel === "sms" && !notification.is_test && attemptNumber === 1) {
      const [setting] = (await this.service.listNotificationChannelSettings(
        { channel: "sms" },
        { order: { version: "DESC" }, take: 1 }
      )) as NotificationChannelSettingRecord[]
      const timezone = process.env.STORE_TIMEZONE || "Europe/Moscow"
      const reserved = await this.service.reserveSmsDailyLimit(
        calendarDateInTimezone(now, timezone),
        timezone,
        setting?.daily_limit ?? DEFAULT_SMS_DAILY_LIMIT
      )
      if (!reserved) {
        await this.service.updateNotificationAttempts({
          id: attempt.id,
          result: "permanent_failure",
          safe_diagnostics: { reason: SMS_DAILY_LIMIT_REASON },
        })
        await this.service.transitionNotification(
          notification.id,
          "processing",
          "permanently_rejected",
          SMS_DAILY_LIMIT_REASON,
          null,
          leaseToken
        )
        return { status: "permanently_rejected", attempt_id: attempt.id }
      }
    }

    let result: DeliveryResult
    try {
      result = await adapter.deliver({
        notification,
        attempt_number: attemptNumber,
        external_id: externalId,
      })
    } catch (error) {
      result = {
        classification:
          notification.channel === "sms" ? "unknown" : "temporary_failure",
        external_id: externalId,
        safe_diagnostics: errorDiagnostics(error),
      }
    }
    result = await reconcileSmsUnknown(
      adapter,
      notification,
      attemptNumber,
      externalId,
      result
    )
    if (notification.channel === "sms") {
      result = { ...result, external_id: externalId }
    }

    await this.service.updateNotificationAttempts({
      id: attempt.id,
      channel_setting_version_id: result.channel_setting_version_id ?? null,
      external_id: result.external_id ?? externalId,
      result: result.classification,
      safe_diagnostics: result.safe_diagnostics ?? {},
    })

    if (result.classification !== "success") {
      this.logIncident(notification, attempt.id, attemptNumber, result)
      incidentContext.alreadyLogged = true
    }

    const target = this.targetState(notification, result, attemptNumber, now)
    await this.service.transitionNotification(
      notification.id,
      "processing",
      target.state,
      target.reason,
      target.nextAttemptAt,
      leaseToken
    )

      return { status: target.state, attempt_id: attempt.id }
    } finally {
      stopHeartbeat()
    }
  }

  async executeIndependently(
    deliveries: readonly { notification_id: string; adapter: DeliveryAdapter }[]
  ) {
    return Promise.allSettled(
      deliveries.map(({ notification_id, adapter }) =>
        this.execute(notification_id, adapter)
      )
    )
  }

  private targetState(
    notification: NotificationForDelivery,
    result: DeliveryResult,
    attemptNumber: number,
    now: Date
  ): {
    state: TerminalDeliveryStatus
    reason: string | null
    nextAttemptAt: Date | null
  } {
    if (result.classification === "success") {
      return { state: "completed", reason: null, nextAttemptAt: null }
    }
    if (result.classification === "permanent_failure") {
      return {
        state: "permanently_rejected",
        reason: result.reason ?? "permanent delivery failure",
        nextAttemptAt: null,
      }
    }
    if (
      result.classification === "unknown" &&
      (notification.channel === "sms" ||
        !shouldRetryUnknown(notification.type))
    ) {
      return {
        state: "outcome_unknown",
        reason: "delivery outcome is unknown",
        nextAttemptAt: null,
      }
    }

    const retryAt = nextRetryAt(notification.created_at, attemptNumber, now)
    return retryAt
      ? {
          state: "retry_pending",
          reason: result.classification,
          nextAttemptAt: retryAt,
        }
      : {
          state: "retries_exhausted",
          reason: "delivery retries exhausted",
          nextAttemptAt: null,
        }
  }

  private startLeaseHeartbeat(notificationId: string, leaseToken: string) {
    const interval = setInterval(() => {
      void this.service
        .renewNotificationDeliveryLease(notificationId, leaseToken)
        .catch(() => undefined)
    }, NOTIFICATION_DELIVERY_LEASE_MS / 3)
    interval.unref?.()
    return () => clearInterval(interval)
  }

  private logIncident(
    notification: NotificationForDelivery,
    attemptId: string,
    attemptNumber: number,
    result: DeliveryResult
  ) {
    try {
      this.logger.error(
        JSON.stringify({
          incident: true,
          kind: "notification_delivery_failure",
          notification_id: notification.id,
          attempt_id: attemptId,
          attempt_number: attemptNumber,
          channel: notification.channel,
          classification: result.classification,
          diagnostics: result.safe_diagnostics ?? {},
        })
      )
    } catch {
      // Incident reporting must never change a delivery state or retry policy.
    }
  }

  private logTechnicalIncident(
    notificationId: string,
    context: { attemptId: string | null; attemptNumber: number | null },
    error: unknown
  ) {
    try {
      this.logger.error(
        JSON.stringify({
          incident: true,
          kind: "notification_delivery_executor_failure",
          notification_id: notificationId,
          attempt_id: context.attemptId,
          attempt_number: context.attemptNumber,
          error_name: error instanceof Error ? error.name : "UnknownError",
        })
      )
    } catch {
      // Incident reporting must never mask the original executor failure.
    }
  }
}
