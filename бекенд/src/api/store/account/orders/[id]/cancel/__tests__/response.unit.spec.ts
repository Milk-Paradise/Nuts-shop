import { catalogOrderCancellationResponse } from "../response"

describe("catalogOrderCancellationResponse", () => {
  it.each([
    ["canceled", "Заказ отменён"],
    ["return_requested", "Заявка на возврат отправлена"],
  ] as const)("returns exactly one buyer outcome for the %s race result", (outcome, message) => {
    const response = catalogOrderCancellationResponse({ id: "order_1" } as any, outcome)

    expect(response).toEqual({
      order: { id: "order_1" },
      outcome,
      message,
    })
    expect([response.outcome]).toHaveLength(1)
    expect(response.outcome).not.toBe(outcome === "canceled" ? "return_requested" : "canceled")
  })
})
