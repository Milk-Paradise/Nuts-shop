export const PAYMENT_OPERATION_TYPES = [
  "payment",
  "refund",
  "cancellation",
] as const

export type PaymentOperationType = (typeof PAYMENT_OPERATION_TYPES)[number]

export const PAYMENT_OPERATION_STATES = [
  "processing",
  "completed",
  "retry_pending",
  "retries_exhausted",
  "result_unknown",
  "declined_final",
] as const

export type PaymentOperationState = (typeof PAYMENT_OPERATION_STATES)[number]

export const FINAL_PAYMENT_OPERATION_STATES = new Set<PaymentOperationState>([
  "completed",
  "declined_final",
])

export type PaymentOperationTransitionSource =
  | "provider"
  | "reconciliation"
  | "manual"

const transitions: Record<PaymentOperationState, Set<PaymentOperationState>> = {
  processing: new Set(PAYMENT_OPERATION_STATES),
  completed: new Set(),
  retry_pending: new Set([
    "processing",
    "completed",
    "retry_pending",
    "retries_exhausted",
    "result_unknown",
    "declined_final",
  ]),
  retries_exhausted: new Set(["completed", "declined_final"]),
  result_unknown: new Set(["completed", "result_unknown", "declined_final"]),
  declined_final: new Set(),
}

export function canTransitionPaymentOperation(input: {
  from: PaymentOperationState
  to: PaymentOperationState
  source: PaymentOperationTransitionSource
}) {
  if (input.from === "retries_exhausted" && input.source !== "manual") {
    return false
  }

  if (
    input.from === "result_unknown" &&
    input.source !== "reconciliation" &&
    input.source !== "manual"
  ) {
    return false
  }

  return transitions[input.from].has(input.to)
}
