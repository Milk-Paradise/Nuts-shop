export const MAX_DELIVERY_ATTEMPTS = 5
export const DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000
export const INITIAL_RETRY_DELAY_MS = 5_000
export const NOTIFICATION_DELIVERY_LEASE_MS = 5 * 60 * 1000

const RETRY_UNKNOWN_NOTIFICATION_TYPES = new Set([
  "customer-password-reset",
  "order-confirmation",
  "order-payment-confirmed",
  "shipping-return-status",
])

export function retryDelayMs(completedAttemptCount: number) {
  if (!Number.isInteger(completedAttemptCount) || completedAttemptCount < 1) {
    throw new Error("Completed attempt count must be a positive integer")
  }

  return INITIAL_RETRY_DELAY_MS * 2 ** (completedAttemptCount - 1)
}

export function shouldRetryUnknown(notificationType: string) {
  return RETRY_UNKNOWN_NOTIFICATION_TYPES.has(notificationType)
}

export function deliveryDeadline(createdAt: Date | string) {
  return new Date(new Date(createdAt).getTime() + DELIVERY_WINDOW_MS)
}

export function nextRetryAt(
  createdAt: Date | string,
  completedAttemptCount: number,
  now: Date
) {
  if (completedAttemptCount >= MAX_DELIVERY_ATTEMPTS) return null

  const candidate = new Date(now.getTime() + retryDelayMs(completedAttemptCount))
  return candidate < deliveryDeadline(createdAt) ? candidate : null
}
