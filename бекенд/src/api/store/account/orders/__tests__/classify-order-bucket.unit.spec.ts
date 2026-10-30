import { classifyOrderBucket, type RawOrder } from "../utils"

function order(overrides: Partial<RawOrder>): RawOrder {
  return { status: "pending", fulfillment_status: "not_fulfilled", ...overrides }
}

describe("classifyOrderBucket", () => {
  it("puts a canceled order in history even if fulfillment was delivered", () => {
    expect(
      classifyOrderBucket(order({ status: "canceled", fulfillment_status: "delivered" }))
    ).toBe("history")
  })

  it("puts a canceled order in history even if fulfillment was never started", () => {
    expect(
      classifyOrderBucket(order({ status: "canceled", fulfillment_status: "not_fulfilled" }))
    ).toBe("history")
  })

  it("puts a delivered, non-canceled order in history", () => {
    expect(
      classifyOrderBucket(order({ status: "completed", fulfillment_status: "delivered" }))
    ).toBe("history")
  })

  it("puts a canceled fulfillment in history even if the order itself isn't canceled", () => {
    expect(
      classifyOrderBucket(order({ status: "pending", fulfillment_status: "canceled" }))
    ).toBe("history")
  })

  it.each([
    "not_fulfilled",
    "partially_fulfilled",
    "fulfilled",
    "partially_shipped",
    "shipped",
    "partially_delivered",
  ])("puts a non-canceled, undelivered order (%s) in in_progress", (fulfillmentStatus) => {
    expect(
      classifyOrderBucket(order({ status: "pending", fulfillment_status: fulfillmentStatus }))
    ).toBe("in_progress")
  })
})
