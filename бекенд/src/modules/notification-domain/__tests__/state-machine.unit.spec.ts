import {
  assertNotificationTransition,
  canTransitionNotification,
  type NotificationState,
} from "../state-machine"

describe("notification state machine", () => {
  it("rejects a transition from an unexpected state", () => {
    expect(() =>
      assertNotificationTransition("completed", "retry_pending")
    ).toThrow("Invalid notification state transition")
  })

  it("makes every one of the six states reachable", () => {
    const reached = new Set<NotificationState>(["processing"])

    for (const state of [
      "completed",
      "retry_pending",
      "retries_exhausted",
      "permanently_rejected",
      "outcome_unknown",
    ] as const) {
      expect(canTransitionNotification("processing", state)).toBe(true)
      reached.add(state)
    }

    expect(reached).toEqual(
      new Set([
        "processing",
        "completed",
        "retry_pending",
        "retries_exhausted",
        "permanently_rejected",
        "outcome_unknown",
      ])
    )
  })

  it("allows a retry claim, expiry, or channel rejection from retry_pending", () => {
    expect(canTransitionNotification("retry_pending", "processing")).toBe(true)
    expect(canTransitionNotification("retry_pending", "retries_exhausted")).toBe(
      true
    )
    expect(
      canTransitionNotification("retry_pending", "permanently_rejected")
    ).toBe(true)
    expect(canTransitionNotification("retry_pending", "completed")).toBe(false)
  })
})
