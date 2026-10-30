import {
  calendarDateInTimezone,
  type DeliveryAdapter,
  NotificationDeliveryExecutor,
  type NotificationForDelivery,
} from "../delivery-executor"

const NOW = new Date("2026-10-07T12:00:00.000Z")

function buildHarness(
  notificationOverrides: Partial<NotificationForDelivery> = {},
  previousAttempts = 0
) {
  let leaseSequence = 0
  const notification: NotificationForDelivery = {
    id: "notif_1",
    type: "order-confirmation",
    recipient: "customer@example.test",
    channel: "email",
    state: "processing",
    content: { subject: "Order", body: "Created" },
    created_at: new Date(NOW.getTime() - 60_000),
    next_attempt_at: null,
    ...notificationOverrides,
  }
  const attempts: Record<string, unknown>[] = Array.from(
    { length: previousAttempts },
    (_, index) => ({
      id: `attempt_${index + 1}`,
      attempt_number: index + 1,
      result: "temporary_failure",
    })
  )
  const logger = { error: jest.fn() }
  const service = {
    retrieveNotificationMessage: jest.fn(async () => ({ ...notification })),
    claimNotificationDeliveryLease: jest.fn(async () => {
      const expiresAt = notification.lease_expires_at
      if (
        notification.state !== "processing" ||
        (notification.lease_token && expiresAt && new Date(expiresAt) > NOW)
      ) {
        return null
      }
      const token = `lease_${++leaseSequence}`
      Object.assign(notification, {
        lease_token: token,
        lease_expires_at: new Date(NOW.getTime() + 5 * 60_000),
      })
      return token
    }),
    renewNotificationDeliveryLease: jest.fn(async (_id: string, token: string) => {
      if (notification.lease_token !== token) return false
      notification.lease_expires_at = new Date(NOW.getTime() + 5 * 60_000)
      return true
    }),
    listNotificationAttempts: jest.fn(async () => attempts),
    createNotificationAttempts: jest.fn(async (input) => {
      if (
        attempts.some(
          (attempt) =>
            attempt.notification_id === input.notification_id &&
            attempt.attempt_number === input.attempt_number
        )
      ) {
        throw new Error("duplicate attempt")
      }
      const attempt = { id: `attempt_${input.attempt_number}`, ...input }
      attempts.push(attempt)
      return attempt
    }),
    updateNotificationAttempts: jest.fn(async (input) => {
      const attempt = attempts.find((candidate) => candidate.id === input.id)
      if (!attempt) throw new Error("attempt not found")
      Object.assign(attempt, input)
      return attempt
    }),
    listNotificationChannelSettings: jest.fn().mockResolvedValue([
      { daily_limit: 100 },
    ]),
    reserveSmsDailyLimit: jest.fn().mockResolvedValue(true),
    transitionNotification: jest.fn(
      async (
        _id: string,
        expected: NotificationForDelivery["state"],
        next: NotificationForDelivery["state"],
        _reason: string | null,
        nextAttemptAt: Date | null,
        leaseToken?: string
      ) => {
        if (
          notification.state !== expected ||
          (leaseToken && notification.lease_token !== leaseToken)
        ) {
          throw new Error("claim lost")
        }
        notification.state = next
        notification.next_attempt_at = nextAttemptAt
        if (leaseToken) {
          Object.assign(notification, { lease_token: null, lease_expires_at: null })
        }
        return { ...notification }
      }
    ),
  }
  const executor = new NotificationDeliveryExecutor(
    service as never,
    logger,
    () => NOW
  )

  return { executor, logger, notification, service }
}

const resultAdapter = (
  classification: "success" | "temporary_failure" | "permanent_failure" | "unknown",
  channel: "email" | "telegram" | "none" = "email"
): DeliveryAdapter => ({
  channel,
  deliver: jest.fn().mockResolvedValue({ classification }),
})

describe("NotificationDeliveryExecutor", () => {
  it("retries password reset delivery with the original secret", async () => {
    const content = {
      subject: "Сброс пароля",
      text: "https://shop.test/reset-password?token=original-secret&email=a%40mail.test",
    }
    const { executor, notification } = buildHarness({ type: "customer-password-reset", content })
    const adapter = {
      channel: "email" as const,
      deliver: jest.fn()
        .mockResolvedValueOnce({ classification: "temporary_failure" })
        .mockResolvedValueOnce({ classification: "success" }),
    }

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({ status: "retry_pending" })
    notification.next_attempt_at = NOW
    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({ status: "completed" })

    expect(adapter.deliver).toHaveBeenCalledTimes(2)
    for (const [input] of adapter.deliver.mock.calls) {
      expect(input.notification.content).toEqual(content)
    }
  })

  it("allows only one concurrent execution to deliver a processing notification", async () => {
    const { executor, notification } = buildHarness()
    let releaseDelivery!: () => void
    const deliveryWait = new Promise<void>((resolve) => {
      releaseDelivery = resolve
    })
    const adapter = {
      channel: "email" as const,
      deliver: jest.fn(async () => {
        await deliveryWait
        return { classification: "success" as const }
      }),
    }

    const first = executor.execute(notification.id, adapter)
    const second = executor.execute(notification.id, adapter)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    releaseDelivery()

    const outcomes = await Promise.all([first, second])
    expect(adapter.deliver).toHaveBeenCalledTimes(1)
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "completed" }),
        { status: "claim_lost" },
      ])
    )
  })

  it("extends the lease while a long delivery is in flight", async () => {
    jest.useFakeTimers()
    const { executor, notification, service } = buildHarness()
    let releaseDelivery!: () => void
    const adapter = {
      channel: "email" as const,
      deliver: jest.fn(
        () =>
          new Promise<{ classification: "success" }>((resolve) => {
            releaseDelivery = () => resolve({ classification: "success" })
          })
      ),
    }

    try {
      const execution = executor.execute(notification.id, adapter)
      await Promise.resolve()
      const initialExpiry = new Date(notification.lease_expires_at!).getTime()
      service.renewNotificationDeliveryLease.mockImplementationOnce(
        async (_id: string, token: string) => {
          if (notification.lease_token !== token) return false
          notification.lease_expires_at = new Date(initialExpiry + 5 * 60_000)
          return true
        }
      )
      await jest.advanceTimersByTimeAsync(100_000)

      expect(service.renewNotificationDeliveryLease).toHaveBeenCalledWith(
        notification.id,
        "lease_1"
      )
      expect(new Date(notification.lease_expires_at!).getTime()).toBeGreaterThan(
        initialExpiry
      )
      releaseDelivery()
      await expect(execution).resolves.toMatchObject({ status: "completed" })
    } finally {
      jest.useRealTimers()
    }
  })

  it("lets a healthy channel finish while another channel is still failing", async () => {
    const telegramHarness = buildHarness({ id: "notif_telegram", channel: "telegram" })
    const emailHarness = buildHarness({ id: "notif_email" })
    let releaseFailure!: () => void
    const failureWait = new Promise<void>((resolve) => {
      releaseFailure = resolve
    })
    const telegram = {
      channel: "telegram" as const,
      deliver: jest.fn(async () => {
        await failureWait
        throw new Error("Telegram unavailable")
      }),
    }
    let markEmailDelivered!: () => void
    const emailDelivered = new Promise<void>((resolve) => {
      markEmailDelivered = resolve
    })
    const email = {
      channel: "email" as const,
      deliver: jest.fn(async () => {
        markEmailDelivered()
        return { classification: "success" as const }
      }),
    }

    const telegramExecution = telegramHarness.executor.execute(
      "notif_telegram",
      telegram
    )
    const emailExecution = emailHarness.executor.execute("notif_email", email)
    await emailDelivered

    expect(email.deliver).toHaveBeenCalledTimes(1)
    releaseFailure()
    await Promise.all([telegramExecution, emailExecution])
  })

  it("moves the fifth temporary failure to retries_exhausted", async () => {
    const { executor, notification } = buildHarness(
      { state: "retry_pending", next_attempt_at: NOW },
      4
    )

    await expect(
      executor.execute(notification.id, resultAdapter("temporary_failure"))
    ).resolves.toMatchObject({ status: "retries_exhausted" })
    expect(notification.state).toBe("retries_exhausted")
  })

  it("never records a permanent SMTP rejection as completed", async () => {
    const { executor, notification, service } = buildHarness()
    const adapter = {
      channel: "email" as const,
      deliver: jest.fn().mockResolvedValue({
        classification: "permanent_failure" as const,
        channel_setting_version_id: "email-v3",
        safe_diagnostics: { response_code: 550 },
      }),
    }

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "permanently_rejected",
    })
    expect(notification.state).toBe("permanently_rejected")
    expect(service.updateNotificationAttempts).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "permanent_failure",
        channel_setting_version_id: "email-v3",
      })
    )
  })

  it("stores the SMTP message id returned by a successful adapter", async () => {
    const { executor, notification, service } = buildHarness()
    const adapter = {
      channel: "email" as const,
      deliver: jest.fn().mockResolvedValue({
        classification: "success" as const,
        external_id: "smtp-message-42",
        channel_setting_version_id: "email-v3",
      }),
    }

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "completed",
    })
    expect(service.updateNotificationAttempts).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "success",
        external_id: "smtp-message-42",
        channel_setting_version_id: "email-v3",
      })
    )
  })

  it("does not retry an unknown abandoned-cart reminder outcome", async () => {
    const { executor, notification } = buildHarness({
      type: "abandoned-cart-reminder",
    })

    await expect(
      executor.execute(notification.id, resultAdapter("unknown"))
    ).resolves.toMatchObject({ status: "outcome_unknown" })
    expect(notification.state).toBe("outcome_unknown")
  })

  it("records the adapter reason for a permanent Telegram rejection", async () => {
    const { executor, notification, service } = buildHarness({
      channel: "telegram",
    })
    const adapter: DeliveryAdapter = {
      channel: "telegram",
      deliver: jest.fn().mockResolvedValue({
        classification: "permanent_failure",
        reason: "покупатель отключил канал",
      }),
    }

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "permanently_rejected",
    })
    expect(service.transitionNotification).toHaveBeenCalledWith(
      notification.id,
      "processing",
      "permanently_rejected",
      "покупатель отключил канал",
      null,
      expect.any(String)
    )
  })

  it("delivers a due retry without rechecking whether its template was disabled", async () => {
    const { executor, notification } = buildHarness({
      state: "retry_pending",
      next_attempt_at: new Date(NOW.getTime() - 1),
    }, 1)
    const adapter = resultAdapter("success")

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "completed",
    })
    expect(adapter.deliver).toHaveBeenCalledTimes(1)
  })

  it("writes one structured incident record with notification and attempt ids", async () => {
    const { executor, logger, notification } = buildHarness()

    await executor.execute(notification.id, resultAdapter("temporary_failure"))

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(JSON.parse(logger.error.mock.calls[0][0])).toMatchObject({
      incident: true,
      notification_id: "notif_1",
      attempt_id: "attempt_1",
      classification: "temporary_failure",
    })
  })

  it("finishes state handling when incident logging fails", async () => {
    const { executor, logger, notification } = buildHarness()
    logger.error.mockImplementation(() => {
      throw new Error("logger unavailable")
    })

    await expect(
      executor.execute(notification.id, resultAdapter("temporary_failure"))
    ).resolves.toMatchObject({ status: "retry_pending" })
    expect(notification.state).toBe("retry_pending")
  })

  it("logs one incident when reserving an attempt fails", async () => {
    const { executor, logger, notification, service } = buildHarness()
    service.createNotificationAttempts.mockRejectedValueOnce(
      new Error("database unavailable")
    )

    await expect(
      executor.execute(notification.id, resultAdapter("success"))
    ).rejects.toThrow("database unavailable")
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(JSON.parse(logger.error.mock.calls[0][0])).toMatchObject({
      incident: true,
      notification_id: notification.id,
      attempt_id: null,
      attempt_number: 1,
    })
  })

  it("reconciles an unknown SMS result before deciding whether to retry", async () => {
    const { executor, notification } = buildHarness({ channel: "sms" })
    const adapter: DeliveryAdapter = {
      channel: "sms",
      deliver: jest.fn().mockResolvedValue({
        classification: "unknown",
        external_id: "sms-client-id",
      }),
      reconcileUnknown: jest.fn().mockResolvedValue({
        classification: "success",
        external_id: "sms-client-id",
      }),
    }

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "completed",
    })
    expect(adapter.reconcileUnknown).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: notification.id })
    )
  })

  it("rejects an SMS permanently when the daily unit cannot be reserved", async () => {
    const { executor, notification, service } = buildHarness({ channel: "sms" })
    service.reserveSmsDailyLimit.mockResolvedValue(false)
    const adapter = {
      channel: "sms" as const,
      deliver: jest.fn(),
      reconcileUnknown: jest.fn(),
    }

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "permanently_rejected",
    })
    expect(adapter.deliver).not.toHaveBeenCalled()
    expect(notification.state).toBe("permanently_rejected")
    expect(service.transitionNotification).toHaveBeenLastCalledWith(
      notification.id,
      "processing",
      "permanently_rejected",
      "лимит",
      null,
      expect.any(String)
    )
  })

  it("uses the current limit and the store calendar date for every SMS attempt", async () => {
    const { executor, service } = buildHarness({ channel: "sms" })
    service.listNotificationChannelSettings.mockResolvedValue([{ daily_limit: 7 }])
    const previousTimezone = process.env.STORE_TIMEZONE
    process.env.STORE_TIMEZONE = "Asia/Vladivostok"

    try {
      await executor.execute("notif_1", {
        channel: "sms",
        deliver: jest.fn().mockResolvedValue({ classification: "success" }),
        reconcileUnknown: jest.fn(),
      })
    } finally {
      if (previousTimezone === undefined) delete process.env.STORE_TIMEZONE
      else process.env.STORE_TIMEZONE = previousTimezone
    }

    expect(service.reserveSmsDailyLimit).toHaveBeenCalledWith(
      calendarDateInTimezone(NOW, "Asia/Vladivostok"),
      "Asia/Vladivostok",
      7
    )
  })

  it("switches the SMS limit day at midnight in the store time zone", () => {
    const beforeMoscowMidnight = new Date("2026-10-08T20:59:59Z")
    const afterMoscowMidnight = new Date("2026-10-08T21:00:00Z")

    expect(calendarDateInTimezone(beforeMoscowMidnight, "Europe/Moscow")).toBe("2026-10-08")
    expect(calendarDateInTimezone(afterMoscowMidnight, "Europe/Moscow")).toBe("2026-10-09")
    expect(calendarDateInTimezone(beforeMoscowMidnight, "Asia/Vladivostok")).toBe("2026-10-09")
    expect(calendarDateInTimezone(afterMoscowMidnight, "UTC")).toBe("2026-10-08")
  })

  it("reserves the daily SMS unit once per notification, not on retries", async () => {
    const { executor, notification, service } = buildHarness({ channel: "sms" })
    const adapter = {
      channel: "sms" as const,
      deliver: jest.fn().mockResolvedValue({ classification: "temporary_failure" as const }),
      reconcileUnknown: jest.fn(),
    }

    await executor.execute(notification.id, adapter)
    notification.next_attempt_at = NOW
    await executor.execute(notification.id, adapter)

    expect(adapter.deliver).toHaveBeenCalledTimes(2)
    expect(service.reserveSmsDailyLimit).toHaveBeenCalledTimes(1)
  })

  it("does not reject an SMS retry by the limit after the first attempt reserved its unit", async () => {
    const { executor, notification, service } = buildHarness({ channel: "sms" })
    const adapter = {
      channel: "sms" as const,
      deliver: jest
        .fn()
        .mockResolvedValueOnce({ classification: "temporary_failure" as const })
        .mockResolvedValueOnce({ classification: "success" as const }),
      reconcileUnknown: jest.fn(),
    }

    await executor.execute(notification.id, adapter)
    service.reserveSmsDailyLimit.mockResolvedValue(false)
    notification.next_attempt_at = NOW

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "completed",
    })
    expect(adapter.deliver).toHaveBeenCalledTimes(2)
  })

  it("uses the same deterministic client id for every SMS attempt", async () => {
    const { executor, notification } = buildHarness({ channel: "sms" })
    const adapter = {
      channel: "sms" as const,
      deliver: jest.fn().mockResolvedValue({
        classification: "temporary_failure" as const,
      }),
      reconcileUnknown: jest.fn(),
    }

    await executor.execute(notification.id, adapter)
    notification.next_attempt_at = NOW
    await executor.execute(notification.id, adapter)

    expect(adapter.deliver).toHaveBeenCalledTimes(2)
    expect(adapter.deliver.mock.calls.map(([input]) => input.external_id)).toEqual([
      notification.id,
      notification.id,
    ])
  })

  it("does not blindly retry an unknown SMS result without reconciliation", async () => {
    const { executor, notification } = buildHarness({ channel: "sms" })
    const legacyAdapter = {
      channel: "sms",
      deliver: jest.fn().mockResolvedValue({ classification: "unknown" }),
    } as unknown as DeliveryAdapter

    await expect(
      executor.execute(notification.id, legacyAdapter)
    ).resolves.toMatchObject({ status: "outcome_unknown" })
    expect(notification.state).toBe("outcome_unknown")
    expect(notification.next_attempt_at).toBeNull()
  })

  it("does not retry when SMS reconciliation still returns unknown", async () => {
    const { executor, notification } = buildHarness({ channel: "sms" })
    const adapter = {
      channel: "sms" as const,
      deliver: jest.fn().mockResolvedValue({ classification: "unknown" as const }),
      reconcileUnknown: jest
        .fn()
        .mockResolvedValue({ classification: "unknown" as const }),
    }

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "outcome_unknown",
    })
    expect(notification.next_attempt_at).toBeNull()
  })

  it("retries a reconciled temporary SMS failure with the same client id", async () => {
    const { executor, notification, service } = buildHarness({ channel: "sms" })
    const adapter = {
      channel: "sms" as const,
      deliver: jest.fn().mockResolvedValue({
        classification: "unknown" as const,
        external_id: "adapter-must-not-replace-client-id",
      }),
      reconcileUnknown: jest.fn().mockResolvedValue({
        classification: "temporary_failure" as const,
        external_id: "adapter-must-not-replace-client-id",
      }),
    }

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "retry_pending",
    })
    expect(adapter.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: notification.id })
    )
    expect(adapter.reconcileUnknown).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: notification.id })
    )
    expect(service.updateNotificationAttempts).toHaveBeenCalledWith(
      expect.objectContaining({
        external_id: notification.id,
        result: "temporary_failure",
      })
    )
  })

  it("does not retry a thrown SMS delivery when reconciliation stays unknown", async () => {
    const { executor, notification } = buildHarness({ channel: "sms" })
    const adapter = {
      channel: "sms" as const,
      deliver: jest.fn().mockRejectedValue(new Error("response lost")),
      reconcileUnknown: jest
        .fn()
        .mockResolvedValue({ classification: "unknown" as const }),
    }

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "outcome_unknown",
    })
    expect(adapter.reconcileUnknown).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: notification.id })
    )
  })

  it("retries a thrown SMS delivery only after reconciliation confirms a temporary failure", async () => {
    const { executor, notification } = buildHarness({ channel: "sms" })
    const adapter = {
      channel: "sms" as const,
      deliver: jest.fn().mockRejectedValue(new Error("response lost")),
      reconcileUnknown: jest
        .fn()
        .mockResolvedValue({ classification: "temporary_failure" as const }),
    }

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "retry_pending",
    })
    expect(notification.next_attempt_at).toEqual(
      new Date(NOW.getTime() + 5_000)
    )
  })

  it("ends an overdue notification without calling its adapter", async () => {
    const { executor, notification } = buildHarness({
      created_at: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    })
    const adapter = resultAdapter("success")

    await expect(executor.execute(notification.id, adapter)).resolves.toMatchObject({
      status: "retries_exhausted",
    })
    expect(adapter.deliver).not.toHaveBeenCalled()
  })
})
