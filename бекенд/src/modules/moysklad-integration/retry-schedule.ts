// Delay before each successive retry after a failed attempt: 1 min, 5 min,
// 30 min, 2 h, 12 h — matching the fixed schedule from spec.md Ф3. Combined
// with the initial attempt made synchronously by the subscriber, this yields
// 1 + RETRY_DELAYS_MINUTES.length = 6 total tries before giving up.
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 720]

export const MAX_ORDER_SYNC_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1

// Safety net for a "syncing" claim left behind by a crashed/killed process —
// after this long with no resolution, treat it as abandoned and eligible for
// retry again rather than stuck forever.
export const STALE_SYNCING_MINUTES = 10

export type OrderSyncRetryState = {
  status: string
  attempts: number
  updated_at: Date
}

/**
 * Returns the delay (in minutes) to wait before the next retry given how many
 * attempts have already been made, or null once all retries are exhausted.
 */
export function getRetryDelayMinutes(attempts: number): number | null {
  if (attempts < 1 || attempts > RETRY_DELAYS_MINUTES.length) {
    return null
  }

  return RETRY_DELAYS_MINUTES[attempts - 1]
}

export function isOrderSyncDueForRetry(
  sync: OrderSyncRetryState,
  now: Date
): boolean {
  if (sync.status === "synced") {
    return false
  }

  if (sync.status === "syncing") {
    const staleAt = sync.updated_at.getTime() + STALE_SYNCING_MINUTES * 60_000

    return now.getTime() >= staleAt
  }

  const delayMinutes = getRetryDelayMinutes(sync.attempts)

  if (delayMinutes === null) {
    return false
  }

  const dueAt = sync.updated_at.getTime() + delayMinutes * 60_000

  return now.getTime() >= dueAt
}
