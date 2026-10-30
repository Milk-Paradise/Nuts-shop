import { MedusaError } from "@medusajs/framework/utils"

import { NOTIFICATION_STATES } from "./models/notification-message"

export type NotificationState =
  | "processing"
  | "completed"
  | "retry_pending"
  | "retries_exhausted"
  | "permanently_rejected"
  | "outcome_unknown"

const transitions: Record<NotificationState, readonly NotificationState[]> = {
  processing: [
    "completed",
    "retry_pending",
    "retries_exhausted",
    "permanently_rejected",
    "outcome_unknown",
  ],
  retry_pending: [
    "processing",
    "retries_exhausted",
    "permanently_rejected",
  ],
  completed: [],
  retries_exhausted: [],
  permanently_rejected: [],
  outcome_unknown: [],
}

export function isNotificationState(value: string): value is NotificationState {
  return (NOTIFICATION_STATES as readonly string[]).includes(value)
}

export function canTransitionNotification(
  from: NotificationState,
  to: NotificationState
) {
  return transitions[from].includes(to)
}

export function assertNotificationTransition(
  from: NotificationState,
  to: NotificationState
) {
  if (!canTransitionNotification(from, to)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid notification state transition: ${from} -> ${to}`
    )
  }
}
