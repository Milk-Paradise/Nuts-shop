import type { MedusaContainer } from "@medusajs/framework/types"

import {
  clearNotificationDeliveryAdapters,
  NOTIFICATION_DOMAIN_MODULE,
  registerNotificationDeliveryAdapter,
} from "../../modules/notification-domain"
import type { NotificationForDelivery } from "../../modules/notification-domain/delivery-executor"
import {
  config,
  sweepNotificationDeliveries,
} from "../notification-delivery-sweep"

const NOW = new Date("2026-10-08T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

type StoredNotification = NotificationForDelivery & {
  is_test: boolean
  lease_token?: string | null
  lease_expires_at?: Date | null
}

function buildContainer(notifications: StoredNotification[]) {
  const attempts: Record<string, unknown>[] = []
  const logger = { error: jest.fn() }
  let leaseSequence = 0
  const service = {
    listNotificationMessages: jest.fn(
      async (filters: Record<string, any>, options?: { skip?: number }) => {
        const matching = notifications.filter((notification) => {
          if (filters.state && notification.state !== filters.state) return false
          if (
            filters.is_test !== undefined &&
            notification.is_test !== filters.is_test
          ) {
            return false
          }
          if (
            filters.created_at?.$lte &&
            new Date(notification.created_at) > filters.created_at.$lte
          ) {
            return false
          }
          if (
            filters.next_attempt_at?.$lte &&
            (!notification.next_attempt_at ||
              new Date(notification.next_attempt_at) >
                filters.next_attempt_at.$lte)
          ) {
            return false
          }
          return true
        })
        return matching.slice(options?.skip ?? 0, (options?.skip ?? 0) + 100)
      }
    ),
    retrieveNotificationMessage: jest.fn(async (id: string) => {
      const notification = notifications.find((candidate) => candidate.id === id)
      if (!notification) throw new Error("notification not found")
      return { ...notification }
    }),
    claimNotificationDeliveryLease: jest.fn(async (id: string) => {
      const notification = notifications.find((candidate) => candidate.id === id)
      if (
        !notification ||
        notification.state !== "processing" ||
        (notification.lease_token &&
          notification.lease_expires_at &&
          notification.lease_expires_at > NOW)
      ) {
        return null
      }
      const token = `lease_${++leaseSequence}`
      notification.lease_token = token
      notification.lease_expires_at = new Date(NOW.getTime() + 5 * 60_000)
      return token
    }),
    renewNotificationDeliveryLease: jest.fn(async (id: string, token: string) => {
      const notification = notifications.find((candidate) => candidate.id === id)
      if (!notification || notification.lease_token !== token) return false
      notification.lease_expires_at = new Date(NOW.getTime() + 5 * 60_000)
      return true
    }),
    listNotificationAttempts: jest.fn(
      async (filters: Record<string, unknown>) =>
        attempts.filter(
          (attempt) =>
            attempt.notification_id === filters.notification_id &&
            (filters.attempt_number === undefined ||
              attempt.attempt_number === filters.attempt_number)
        )
    ),
    createNotificationAttempts: jest.fn(async (input) => {
      const attempt = { id: `attempt_${attempts.length + 1}`, ...input }
      attempts.push(attempt)
      return attempt
    }),
    updateNotificationAttempts: jest.fn(async (input) => {
      const attempt = attempts.find((candidate) => candidate.id === input.id)
      if (!attempt) throw new Error("attempt not found")
      Object.assign(attempt, input)
      return attempt
    }),
    exhaustProcessingNotificationIfLeaseExpired: jest.fn(
      async (id: string, _leaseExpiredBefore: Date) => {
        const notification = notifications.find((candidate) => candidate.id === id)
        if (
          !notification ||
          notification.state !== "processing" ||
          (notification.lease_token &&
            notification.lease_expires_at &&
            notification.lease_expires_at > NOW)
        ) {
          return false
        }
        notification.state = "retries_exhausted"
        notification.next_attempt_at = null
        notification.lease_token = null
        notification.lease_expires_at = null
        return true
      }
    ),
    transitionNotification: jest.fn(
      async (
        id: string,
        expected: NotificationForDelivery["state"],
        next: NotificationForDelivery["state"],
        reason: string | null,
        nextAttemptAt: Date | null,
        leaseToken?: string
      ) => {
        const notification = notifications.find((candidate) => candidate.id === id)
        if (
          !notification ||
          notification.state !== expected ||
          (leaseToken && notification.lease_token !== leaseToken)
        ) {
          throw new Error("claim lost")
        }
        notification.state = next
        notification.next_attempt_at = nextAttemptAt
        if (leaseToken) {
          notification.lease_token = null
          notification.lease_expires_at = null
        }
        return { ...notification, reason }
      }
    ),
  }
  const container = {
    resolve: jest.fn((key: string) =>
      key === NOTIFICATION_DOMAIN_MODULE ? service : logger
    ),
  } as unknown as MedusaContainer

  return { attempts, container, logger, service }
}

function notification(
  id: string,
  overrides: Partial<StoredNotification> = {}
): StoredNotification {
  return {
    id,
    type: "order-confirmation",
    recipient: `${id}@example.test`,
    channel: "email",
    state: "processing",
    content: {},
    created_at: new Date(NOW.getTime() - DAY),
    next_attempt_at: null,
    is_test: false,
    ...overrides,
  }
}

describe("notification delivery sweep job", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW)
    clearNotificationDeliveryAdapters()
  })

  afterEach(() => {
    clearNotificationDeliveryAdapters()
    jest.useRealTimers()
  })

  it("runs every minute", () => {
    expect(config).toEqual({
      name: "notification-delivery-sweep",
      schedule: "* * * * *",
    })
  })

  it("makes every non-test notification terminal after 24 hours", async () => {
    const notifications = [
      notification("processing"),
      notification("retry", { state: "retry_pending", next_attempt_at: NOW }),
      notification("test", { is_test: true }),
    ]
    const { container } = buildContainer(notifications)

    await expect(sweepNotificationDeliveries(container)).resolves.toEqual({
      exhausted: 2,
      executed: 0,
    })
    expect(notifications.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: "processing", state: "retries_exhausted" },
      { id: "retry", state: "retries_exhausted" },
      { id: "test", state: "processing" },
    ])
  })

  it("executes a due retry through the registered channel adapter", async () => {
    const due = notification("due", {
      state: "retry_pending",
      created_at: new Date(NOW.getTime() - 60_000),
      next_attempt_at: NOW,
    })
    const { container } = buildContainer([due])
    const adapter = {
      channel: "email" as const,
      deliver: jest.fn().mockResolvedValue({ classification: "success" as const }),
    }
    registerNotificationDeliveryAdapter("email", adapter)

    await expect(sweepNotificationDeliveries(container)).resolves.toEqual({
      exhausted: 0,
      executed: 1,
    })
    expect(adapter.deliver).toHaveBeenCalledTimes(1)
    expect(due.state).toBe("completed")
  })

  it("does not let a hanging Telegram retry delay the email retry", async () => {
    const dueRetry = (id: string, channel: StoredNotification["channel"]) =>
      notification(id, {
        channel,
        state: "retry_pending",
        created_at: new Date(NOW.getTime() - 60_000),
        next_attempt_at: NOW,
      })
    const { container } = buildContainer([
      dueRetry("telegram-first", "telegram"),
      dueRetry("email-second", "email"),
    ])
    let releaseTelegram: () => void = () => undefined
    const telegram = {
      channel: "telegram" as const,
      deliver: jest.fn(
        () =>
          new Promise<{ classification: "success" }>((resolve) => {
            releaseTelegram = () => resolve({ classification: "success" })
          })
      ),
    }
    const email = {
      channel: "email" as const,
      deliver: jest.fn().mockResolvedValue({ classification: "success" as const }),
    }
    registerNotificationDeliveryAdapter("telegram", telegram)
    registerNotificationDeliveryAdapter("email", email)

    const sweep = sweepNotificationDeliveries(container)
    for (let tick = 0; tick < 100 && !email.deliver.mock.calls.length; tick += 1) {
      await Promise.resolve()
    }

    expect(telegram.deliver).toHaveBeenCalledTimes(1)
    expect(email.deliver).toHaveBeenCalledTimes(1)
    releaseTelegram()
    await expect(sweep).resolves.toEqual({ exhausted: 0, executed: 2 })
  })

  it("skips a due retry when its channel has no registered adapter", async () => {
    const due = notification("due", {
      state: "retry_pending",
      created_at: new Date(NOW.getTime() - 60_000),
      next_attempt_at: NOW,
    })
    const { container } = buildContainer([due])

    await expect(sweepNotificationDeliveries(container)).resolves.toEqual({
      exhausted: 0,
      executed: 0,
    })
    expect(due.state).toBe("retry_pending")
  })

  it("keeps a processing notification with a fresh active lease", async () => {
    const processing = notification("processing", {
      lease_token: "active-owner",
      lease_expires_at: new Date(NOW.getTime() + 60_000),
    })
    const { container } = buildContainer([processing])

    await expect(sweepNotificationDeliveries(container)).resolves.toEqual({
      exhausted: 0,
      executed: 0,
    })
    expect(processing.state).toBe("processing")
  })

  it("exhausts a processing notification after its lease expires", async () => {
    const processing = notification("processing", {
      lease_token: "expired-owner",
      lease_expires_at: new Date(NOW.getTime() - 1),
    })
    const { container } = buildContainer([processing])

    await expect(sweepNotificationDeliveries(container)).resolves.toEqual({
      exhausted: 1,
      executed: 0,
    })
    expect(processing.state).toBe("retries_exhausted")
  })

  it("does not duplicate a terminal transition when the atomic lease claim is lost", async () => {
    const processing = notification("processing")
    const { container, service } = buildContainer([processing])
    service.exhaustProcessingNotificationIfLeaseExpired.mockResolvedValueOnce(false)

    await expect(sweepNotificationDeliveries(container)).resolves.toEqual({
      exhausted: 0,
      executed: 0,
    })

    expect(processing.state).toBe("processing")
    expect(service.transitionNotification).not.toHaveBeenCalled()
  })

  it("continues after one notification fails and logs one incident", async () => {
    const notifications = [notification("broken"), notification("healthy")]
    const { container, logger, service } = buildContainer(notifications)
    const exhaust = service.exhaustProcessingNotificationIfLeaseExpired.getMockImplementation()!
    service.exhaustProcessingNotificationIfLeaseExpired.mockImplementation(async (...args: any[]) => {
      if (args[0] === "broken") throw new Error("database unavailable")
      return exhaust(args[0], args[1])
    })

    await expect(sweepNotificationDeliveries(container)).resolves.toEqual({
      exhausted: 1,
      executed: 0,
    })
    expect(notifications[1].state).toBe("retries_exhausted")
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(JSON.parse(logger.error.mock.calls[0][0])).toMatchObject({
      incident: true,
      notification_id: "broken",
      attempt_id: null,
    })
  })
})
