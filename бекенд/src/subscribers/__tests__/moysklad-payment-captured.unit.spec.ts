jest.mock("../../workflows/sync-moysklad-captured-payment", () => ({
  syncMoyskladCapturedPaymentWorkflow: jest.fn(),
}))

import { syncMoyskladCapturedPaymentWorkflow } from "../../workflows/sync-moysklad-captured-payment"
import syncCapturedPaymentToMoysklad, { config, isOrderFullyPaid } from "../moysklad-payment-captured"

const workflow = syncMoyskladCapturedPaymentWorkflow as unknown as jest.Mock

describe("MoySklad captured payment subscriber", () => {
  beforeEach(() => workflow.mockReset())

  it("uses payment.captured and delegates the mutation to the workflow", async () => {
    const run = jest.fn().mockResolvedValue(undefined)
    workflow.mockReturnValue({ run })
    const container = { resolve: jest.fn() }

    await syncCapturedPaymentToMoysklad({ event: { name: "payment.captured", data: { id: "pay_1" } }, container } as never)

    expect(config.event).toBe("payment.captured")
    expect(workflow).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({ input: { paymentId: "pay_1" } })
  })
})

describe("isOrderFullyPaid", () => {
  it("classifies computed payment state from captures", () => {
    expect(isOrderFullyPaid({ id: "o", total: 100, currency_code: "rub", payment_collections: [{ payments: [{ captures: [{ amount: 60, created_at: new Date() }, { amount: 40, created_at: new Date() }] }] }] })).toEqual({ fullyPaid: true, capturedAmount: 100 })
    expect(isOrderFullyPaid({ id: "o", total: 100, currency_code: "rub", payment_collections: [{ payments: [{ captures: [{ amount: 99, created_at: new Date() }] }] }] }).fullyPaid).toBe(false)
  })
})
