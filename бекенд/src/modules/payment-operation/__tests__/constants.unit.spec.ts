import {
  canTransitionPaymentOperation,
  PAYMENT_OPERATION_STATES,
} from "../constants"

describe("payment operation state machine", () => {
  it("contains exactly the six D7 states", () => {
    expect(PAYMENT_OPERATION_STATES).toEqual([
      "processing",
      "completed",
      "retry_pending",
      "retries_exhausted",
      "result_unknown",
      "declined_final",
    ])
  })

  it("rejects a repeated final transition", () => {
    expect(
      canTransitionPaymentOperation({
        from: "completed",
        to: "completed",
        source: "reconciliation",
      })
    ).toBe(false)
    expect(
      canTransitionPaymentOperation({
        from: "declined_final",
        to: "completed",
        source: "reconciliation",
      })
    ).toBe(false)
  })

  it("allows unknown results to finish only after reconciliation", () => {
    expect(
      canTransitionPaymentOperation({
        from: "result_unknown",
        to: "completed",
        source: "provider",
      })
    ).toBe(false)
    expect(
      canTransitionPaymentOperation({
        from: "result_unknown",
        to: "completed",
        source: "reconciliation",
      })
    ).toBe(true)
  })

  it("allows exhausted retries to finish only after manual verification", () => {
    expect(
      canTransitionPaymentOperation({
        from: "retries_exhausted",
        to: "declined_final",
        source: "provider",
      })
    ).toBe(false)
    expect(
      canTransitionPaymentOperation({
        from: "retries_exhausted",
        to: "declined_final",
        source: "manual",
      })
    ).toBe(true)
  })
})
