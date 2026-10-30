import {
  MAX_ORDER_SYNC_ATTEMPTS,
  STALE_SYNCING_MINUTES,
  getRetryDelayMinutes,
  isOrderSyncDueForRetry,
} from "../retry-schedule"

describe("getRetryDelayMinutes", () => {
  it("returns the fixed schedule 1/5/30/120/720 minutes for attempts 1 through 5", () => {
    expect(getRetryDelayMinutes(1)).toBe(1)
    expect(getRetryDelayMinutes(2)).toBe(5)
    expect(getRetryDelayMinutes(3)).toBe(30)
    expect(getRetryDelayMinutes(4)).toBe(120)
    expect(getRetryDelayMinutes(5)).toBe(720)
  })

  it("returns null once all 5 retries are exhausted", () => {
    expect(getRetryDelayMinutes(6)).toBeNull()
    expect(getRetryDelayMinutes(10)).toBeNull()
  })

  it("returns null for a non-positive attempt count", () => {
    expect(getRetryDelayMinutes(0)).toBeNull()
  })
})

describe("MAX_ORDER_SYNC_ATTEMPTS", () => {
  it("allows exactly 1 initial attempt plus 5 retries", () => {
    expect(MAX_ORDER_SYNC_ATTEMPTS).toBe(6)
  })

  it("stops scheduling once attempts reaches the cap, having scheduled exactly 5 retries", () => {
    const scheduledDelays: number[] = []

    for (let attempts = 1; attempts <= MAX_ORDER_SYNC_ATTEMPTS + 2; attempts++) {
      const delay = getRetryDelayMinutes(attempts)

      if (delay !== null) {
        scheduledDelays.push(delay)
      }
    }

    expect(scheduledDelays).toEqual([1, 5, 30, 120, 720])
  })
})

describe("isOrderSyncDueForRetry", () => {
  const now = new Date("2026-01-01T12:00:00Z")

  it("is not due when already synced", () => {
    expect(
      isOrderSyncDueForRetry(
        { status: "synced", attempts: 1, updated_at: new Date("2026-01-01T00:00:00Z") },
        now
      )
    ).toBe(false)
  })

  it("is not due before the scheduled delay has elapsed", () => {
    expect(
      isOrderSyncDueForRetry(
        { status: "error", attempts: 1, updated_at: new Date("2026-01-01T11:59:30Z") },
        now
      )
    ).toBe(false)
  })

  it("is due once the scheduled delay has elapsed", () => {
    expect(
      isOrderSyncDueForRetry(
        { status: "error", attempts: 1, updated_at: new Date("2026-01-01T11:59:00Z") },
        now
      )
    ).toBe(true)
  })

  it("is not due once all retries are exhausted, however long it has waited", () => {
    expect(
      isOrderSyncDueForRetry(
        { status: "error", attempts: 6, updated_at: new Date("2020-01-01T00:00:00Z") },
        now
      )
    ).toBe(false)
  })

  it("uses the growing interval for later attempts (30 minutes after attempt 3)", () => {
    expect(
      isOrderSyncDueForRetry(
        { status: "error", attempts: 3, updated_at: new Date("2026-01-01T11:31:00Z") },
        now
      )
    ).toBe(false)
    expect(
      isOrderSyncDueForRetry(
        { status: "error", attempts: 3, updated_at: new Date("2026-01-01T11:30:00Z") },
        now
      )
    ).toBe(true)
  })

  it("is not due while a claimed retry is still in progress, regardless of the attempt schedule", () => {
    expect(
      isOrderSyncDueForRetry(
        { status: "syncing", attempts: 1, updated_at: new Date("2026-01-01T11:59:00Z") },
        now
      )
    ).toBe(false)
  })

  it("treats an in-progress claim as abandoned and due again after the stale timeout", () => {
    const justBeforeStale = new Date(
      now.getTime() - STALE_SYNCING_MINUTES * 60_000 + 1_000
    )
    const atStale = new Date(now.getTime() - STALE_SYNCING_MINUTES * 60_000)

    expect(
      isOrderSyncDueForRetry(
        { status: "syncing", attempts: 1, updated_at: justBeforeStale },
        now
      )
    ).toBe(false)
    expect(
      isOrderSyncDueForRetry(
        { status: "syncing", attempts: 1, updated_at: atStale },
        now
      )
    ).toBe(true)
  })
})
