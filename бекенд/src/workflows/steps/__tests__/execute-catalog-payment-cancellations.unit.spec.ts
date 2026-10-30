import { MedusaError } from "@medusajs/framework/utils"

import { executeCatalogPaymentCancellations } from "../execute-catalog-payment-cancellations"

function setup(state = "processing") {
  const paymentModule = { cancelPayment: jest.fn().mockResolvedValue({ id: "pay_1" }) }
  const operationModule = {
    claimPaymentOperation: jest.fn().mockResolvedValue({
      operation: { id: "op_cancel", state },
      created: state === "processing",
    }),
    transitionPaymentOperation: jest.fn().mockResolvedValue({ applied: true }),
  }
  const container = {
    resolve: jest.fn((key: string) =>
      key === "paymentOperation" ? operationModule : paymentModule
    ),
  }
  const input = {
    order_id: "order_1",
    payments: [{
      payment_id: "pay_1",
      provider_id: "pp_test_test",
      amount: 1500,
      currency_code: "rub",
    }],
  }
  return { container: container as any, input, operationModule, paymentModule }
}

describe("executeCatalogPaymentCancellations", () => {
  it("executes and records one cancellation", async () => {
    const { container, input, operationModule, paymentModule } = setup()
    await expect(executeCatalogPaymentCancellations(container, input)).resolves.toEqual({
      operation_ids: ["op_cancel"],
    })
    expect(paymentModule.cancelPayment).toHaveBeenCalledTimes(1)
    expect(operationModule.claimPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: "payment-action:pay_1" })
    )
    expect(operationModule.transitionPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({ to_state: "completed", result: "canceled" })
    )
  })

  it("does not call the provider again for a completed cancellation", async () => {
    const { container, input, operationModule, paymentModule } = setup("completed")
    await executeCatalogPaymentCancellations(container, input)
    expect(paymentModule.cancelPayment).not.toHaveBeenCalled()
    expect(operationModule.transitionPaymentOperation).not.toHaveBeenCalled()
  })

  it("blocks a repeated provider call while the result is unknown", async () => {
    const { container, input, paymentModule } = setup("result_unknown")
    await expect(executeCatalogPaymentCancellations(container, input)).rejects.toBeInstanceOf(
      MedusaError
    )
    expect(paymentModule.cancelPayment).not.toHaveBeenCalled()
  })
})
