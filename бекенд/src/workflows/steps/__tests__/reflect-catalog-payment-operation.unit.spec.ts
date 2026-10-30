jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: string, invoke: unknown) => invoke,
  StepResponse: class StepResponse<T> {
    constructor(readonly result: T) {}
  },
}))

import { MedusaError } from "@medusajs/framework/utils"

import { reflectCompletedCatalogPaymentOperationForOrder } from "../reflect-catalog-payment-operation"

function setup(completed: Array<{ id: string }>) {
  const operations = {
    listPaymentOperations: jest.fn().mockResolvedValue(completed),
    markPaymentOperationResultReflected: jest.fn().mockResolvedValue({
      applied: true,
    }),
  }
  const container = {
    resolve: jest.fn(() => operations),
  }

  return { container: container as any, operations }
}

describe("reflectCompletedCatalogPaymentOperationForOrder", () => {
  it("recovers an unreflected completed payment for an existing order", async () => {
    const { container, operations } = setup([{ id: "op_payment" }])

    await expect(
      reflectCompletedCatalogPaymentOperationForOrder(container, {
        cart_id: "cart_1",
        order_id: "order_1",
      })
    ).resolves.toEqual({ applied: true })
    expect(operations.markPaymentOperationResultReflected).toHaveBeenCalledWith({
      operation_id: "op_payment",
      order_id: "order_1",
    })
  })

  it("keeps legacy orders without an operation compatible", async () => {
    const { container, operations } = setup([])

    await expect(
      reflectCompletedCatalogPaymentOperationForOrder(container, {
        cart_id: "cart_legacy",
        order_id: "order_legacy",
      })
    ).resolves.toEqual({ operation: null, applied: false })
    expect(operations.markPaymentOperationResultReflected).not.toHaveBeenCalled()
  })

  it("rejects two final payment results for one cart", async () => {
    const { container } = setup([{ id: "op_1" }, { id: "op_2" }])

    await expect(
      reflectCompletedCatalogPaymentOperationForOrder(container, {
        cart_id: "cart_1",
        order_id: "order_1",
      })
    ).rejects.toBeInstanceOf(MedusaError)
  })
})
