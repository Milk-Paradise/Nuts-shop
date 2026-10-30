jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: string, invoke: unknown) => invoke,
  StepResponse: class StepResponse<T> {
    constructor(readonly result: T) {}
  },
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import {
  CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY,
  reconcileCatalogRefundWebhookStep,
  YOOKASSA_REFUND_ID_METADATA_KEY,
} from "../reconcile-catalog-refund-webhook"

const input = {
  refund_id: "yk-refund-1",
  payment_id: "yk-payment-1",
  amount: "100.00",
  currency_code: "rub",
  payment_session_id: "payses-1",
  payment_data: {
    id: "yk-payment-1",
    status: "succeeded",
    amount: { value: "1500.00", currency: "RUB" },
    refunded_amount: { value: "100.00", currency: "RUB" },
    metadata: { session_id: "payses-1" },
  },
}

function setup(
  refundOperationCount = 1,
  refundOverrides: Record<string, unknown> = {},
  orderGraph: Record<string, unknown> = { id: "order-1" },
  initialPaymentData: Record<string, unknown> = { id: "yk-payment-1" }
) {
  const refunds: any[] = []
  let transaction: any
  let paymentData: Record<string, unknown> = initialPaymentData
  let activeLockKey: string | null = null
  const transactionReadLockKeys: Array<string | null> = []
  const paymentOperation: any = {
    id: "payment-operation-1",
    type: "payment",
    provider_id: "yookassa",
    provider_operation_id: "yk-payment-1",
    state: "completed",
    amount: 1500,
    currency_code: "rub",
  }
  const refundOperations: any[] = Array.from(
    { length: refundOperationCount },
    (_, index) => ({
      id: `refund-operation-${index + 1}`,
      type: "refund",
      provider_id: "pp_yookassa_yookassa",
      provider_operation_id: null,
      original_payment_id: "payment-1",
      order_id: "order-1",
      state: "processing",
      amount: 100,
      currency_code: "rub",
      result_reflected_at: null,
      idempotency_key: "refund-request:request-1:payment-1",
      ...refundOverrides,
    })
  )
  const paymentModule = {
    retrievePaymentSession: jest.fn().mockResolvedValue({
      id: "payses-1",
      provider_id: "pp_yookassa_yookassa",
      amount: 1500,
      currency_code: "rub",
      data: {
        id: "yk-payment-1",
        payment_operation_id: "payment-operation-1",
      },
      payment: { id: "payment-1" },
    }),
    retrievePayment: jest.fn().mockImplementation(async () => ({
      id: "payment-1",
      provider_id: "pp_yookassa_yookassa",
      amount: 1500,
      currency_code: "rub",
      data: paymentData,
      refunds: [...refunds],
    })),
    createRefunds: jest.fn().mockImplementation(async (value) => {
      const refund = {
        id: `local-refund-${refunds.length + 1}`,
        amount: value.amount,
        metadata: value.metadata,
      }
      refunds.push(refund)
      return refund
    }),
    updateRefunds: jest.fn().mockImplementation(async (value) => {
      const index = refunds.findIndex((candidate) => candidate.id === value.id)
      refunds[index] = { ...refunds[index], metadata: value.metadata }
      return refunds[index]
    }),
    updatePayment: jest.fn().mockImplementation(async ({ data }) => {
      paymentData = data
      return {}
    }),
  }
  const orderModule = {
    listOrderTransactions: jest.fn().mockImplementation(async () => {
      transactionReadLockKeys.push(activeLockKey)
      return transaction ? [transaction] : []
    }),
    addOrderTransactions: jest.fn().mockImplementation(async (value) => {
      if (
        activeLockKey !==
        `catalog-order-refund-ledger:${value.order_id}:${value.reference_id}`
      ) {
        throw new Error("order refund transaction must be added under lock")
      }
      transaction = { id: "transaction-1", ...value }
      return transaction
    }),
    updateOrders: jest.fn().mockResolvedValue({ id: "order-1" }),
  }
  const query = {
    graph: jest.fn().mockResolvedValue({ data: [orderGraph] }),
  }
  const operations = {
    listPaymentOperations: jest.fn().mockImplementation(async (filter) =>
      filter.type === "payment" ? [paymentOperation] : refundOperations
    ),
    listPaymentOperationAttempts: jest.fn().mockResolvedValue([]),
    transitionPaymentOperation: jest.fn().mockImplementation(async (value) => {
      const operation = refundOperations.find(
        (candidate) => candidate.id === value.operation_id
      )
      operation.state = value.to_state
      operation.provider_operation_id = value.provider_operation_id
      return { operation, applied: true }
    }),
    updatePaymentOperations: jest.fn().mockImplementation(async (value) => {
      const operation = refundOperations.find(
        (candidate) => candidate.id === value.id
      )
      operation.provider_operation_id = value.provider_operation_id
      return operation
    }),
    markPaymentOperationResultReflected: jest
      .fn()
      .mockImplementation(async ({ operation_id }) => {
        const operation = refundOperations.find(
          (candidate) => candidate.id === operation_id
        )
        operation.result_reflected_at = new Date()
        return { operation, applied: true }
      }),
  }
  const locking = {
    execute: jest.fn(async (key: string, callback: () => Promise<unknown>) => {
      const previousLockKey = activeLockKey
      activeLockKey = key
      try {
        return await callback()
      } finally {
        activeLockKey = previousLockKey
      }
    }),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "payment") return paymentModule
      if (key === "order") return orderModule
      if (key === Modules.LOCKING) return locking
      if (key === ContainerRegistrationKeys.QUERY) return query
      return operations
    }),
  }

  return {
    container: container as any,
    paymentModule,
    orderModule,
    operations,
    query,
    locking,
    refundOperations,
    transactionReadLockKeys,
  }
}

const invoke = reconcileCatalogRefundWebhookStep as any

describe("reconcileCatalogRefundWebhookStep", () => {
  it("creates one local refund and reflects duplicate refund.succeeded events idempotently", async () => {
    const {
      container,
      paymentModule,
      orderModule,
      operations,
      locking,
      transactionReadLockKeys,
    } = setup()

    await invoke(input, { container })
    await invoke(input, { container })

    expect(paymentModule.createRefunds).toHaveBeenCalledTimes(1)
    expect(paymentModule.createRefunds).toHaveBeenCalledWith({
      payment_id: "payment-1",
      amount: "100.00",
      metadata: {
        [CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY]: "refund-operation-1",
        [YOOKASSA_REFUND_ID_METADATA_KEY]: "yk-refund-1",
      },
    })
    expect(paymentModule.updatePayment).toHaveBeenCalledTimes(2)
    expect(orderModule.addOrderTransactions).toHaveBeenCalledTimes(1)
    expect(locking.execute).toHaveBeenCalledTimes(4)
    expect(locking.execute).toHaveBeenCalledWith(
      "catalog-yookassa-refund:payment-1",
      expect.any(Function),
      { timeout: 300 }
    )
    expect(locking.execute).toHaveBeenCalledWith(
      "catalog-order-refund-ledger:order-1:local-refund-1",
      expect.any(Function),
      { timeout: 120 }
    )
    expect(transactionReadLockKeys).toContain(
      "catalog-order-refund-ledger:order-1:local-refund-1"
    )
    expect(operations.transitionPaymentOperation).toHaveBeenCalledTimes(1)
    expect(operations.markPaymentOperationResultReflected).toHaveBeenCalledTimes(2)
  })

  it("preserves separate webhook refund history entries for one payment", async () => {
    const { container, paymentModule, refundOperations } = setup(2)
    refundOperations[0].provider_operation_id = "yk-refund-1"
    refundOperations[1].provider_operation_id = "yk-refund-2"
    const secondInput = {
      ...input,
      refund_id: "yk-refund-2",
      payment_data: {
        ...input.payment_data,
        refunded_amount: { value: "200.00", currency: "RUB" },
      },
    }

    await invoke(input, { container })
    await invoke(secondInput, { container })

    const finalData = (paymentModule.updatePayment as jest.Mock).mock.calls[1][0]
      .data as { yookassa_refunds: Array<{ id: string }> }
    expect(finalData.yookassa_refunds.map(({ id }) => id)).toEqual([
      "yk-refund-1",
      "yk-refund-2",
    ])
    expect(finalData).toMatchObject({
      refunded_amount: { value: "200.00", currency: "RUB" },
    })
  })

  it("preserves newer refund totals over stale webhook snapshots", async () => {
    const { container, paymentModule } = setup(
      1,
      {},
      { id: "order-1" },
      {
        id: "yk-payment-1",
        refunded_amount: { value: "200.00", currency: "RUB" },
        yookassa_refunds: [
          {
            id: "yk-refund-earlier",
            payment_id: "yk-payment-1",
            amount: "100.00",
            currency: "RUB",
            status: "succeeded",
          },
        ],
        local_payment_operation_id: "payment-operation-1",
      }
    )
    const staleInput = {
      ...input,
      payment_data: {
        ...input.payment_data,
        refunded_amount: { value: "100.00", currency: "RUB" },
      },
    }

    await invoke(staleInput, { container })

    const finalData = (paymentModule.updatePayment as jest.Mock).mock.calls[0][0]
      .data as Record<string, unknown>
    expect(finalData.refunded_amount).toEqual({
      value: "200.00",
      currency: "RUB",
    })
    expect(finalData.local_payment_operation_id).toBe("payment-operation-1")
    expect(finalData.yookassa_refunds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: input.refund_id, status: "succeeded" }),
      ])
    )
  })

  it.each(["Infinity", "1500.01", Infinity])(
    "rejects malformed or over-payment refunded totals (%s) before creating refunds",
    async (refundedTotal) => {
      const { container, paymentModule } = setup()
      const invalidInput = {
        ...input,
        payment_data: {
          ...input.payment_data,
          refunded_amount: { value: refundedTotal, currency: "RUB" },
        },
      }

      await expect(invoke(invalidInput, { container })).rejects.toThrow()
      expect(paymentModule.createRefunds).not.toHaveBeenCalled()
      expect(paymentModule.updatePayment).not.toHaveBeenCalled()
    }
  )

  it.each(["provider_operation_id", "local_refund_metadata"])(
    "uses the exact YooKassa refund ID before amount fallback when same-amount refunds exist (%s)",
    async (correlation) => {
      const { container, paymentModule, orderModule, operations, refundOperations } =
        setup(2)
      refundOperations[0].state = "completed"
      refundOperations[1].state = "completed"

      if (correlation === "provider_operation_id") {
        refundOperations[0].provider_operation_id = "yk-refund-old"
        refundOperations[1].provider_operation_id = input.refund_id
      } else {
        refundOperations[0].provider_operation_id = "local-refund-old"
        refundOperations[1].provider_operation_id = "local-refund-current"
        paymentModule.retrievePayment.mockResolvedValueOnce({
          id: "payment-1",
          provider_id: "pp_yookassa_yookassa",
          amount: 1500,
          currency_code: "rub",
          data: { id: "yk-payment-1" },
          refunds: [
            {
              id: "local-refund-old",
              amount: "100.00",
              metadata: {
                [CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY]:
                  "refund-operation-1",
                [YOOKASSA_REFUND_ID_METADATA_KEY]: "yk-refund-old",
              },
            },
            {
              id: "local-refund-current",
              amount: "100.00",
              metadata: {
                [CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY]:
                  "refund-operation-2",
                [YOOKASSA_REFUND_ID_METADATA_KEY]: input.refund_id,
              },
            },
          ],
        })
      }

      await invoke(input, { container })

      if (correlation === "provider_operation_id") {
        expect(paymentModule.createRefunds).toHaveBeenCalledWith({
          payment_id: "payment-1",
          amount: input.amount,
          metadata: {
            [CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY]: "refund-operation-2",
            [YOOKASSA_REFUND_ID_METADATA_KEY]: input.refund_id,
          },
        })
      } else {
        expect(paymentModule.createRefunds).not.toHaveBeenCalled()
        expect(orderModule.addOrderTransactions).toHaveBeenCalledWith(
          expect.objectContaining({ reference_id: "local-refund-current" })
        )
      }
      expect(operations.markPaymentOperationResultReflected).toHaveBeenCalledWith(
        expect.objectContaining({ operation_id: "refund-operation-2" })
      )
    }
  )

  it("ignores a completed same-amount operation only when its local refund proves a different YooKassa ID", async () => {
    const { container, paymentModule, operations, refundOperations } = setup(2)
    refundOperations[0].state = "completed"
    refundOperations[0].provider_operation_id = "yk-refund-old"
    refundOperations[1].state = "processing"
    refundOperations[1].provider_operation_id = null
    paymentModule.retrievePayment.mockResolvedValueOnce({
      id: "payment-1",
      provider_id: "pp_yookassa_yookassa",
      amount: 1500,
      currency_code: "rub",
      data: { id: "yk-payment-1" },
      refunds: [
        {
          id: "local-refund-old",
          amount: "100.00",
          metadata: {
            [CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY]:
              "refund-operation-1",
            [YOOKASSA_REFUND_ID_METADATA_KEY]: "yk-refund-old",
          },
        },
      ],
    })

    await invoke(input, { container })

    expect(paymentModule.createRefunds).toHaveBeenCalledWith({
      payment_id: "payment-1",
      amount: input.amount,
      metadata: {
        [CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY]: "refund-operation-2",
        [YOOKASSA_REFUND_ID_METADATA_KEY]: input.refund_id,
      },
    })
    expect(operations.transitionPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation_id: "refund-operation-2" })
    )
  })

  it("fails closed on ambiguous equal-amount operations before mutating Medusa", async () => {
    const { container, paymentModule, orderModule } = setup(2)

    await expect(invoke(input, { container })).rejects.toThrow(
      "Невозможно однозначно сопоставить возврат ЮKassa"
    )
    expect(paymentModule.createRefunds).not.toHaveBeenCalled()
    expect(paymentModule.updateRefunds).not.toHaveBeenCalled()
    expect(paymentModule.updatePayment).not.toHaveBeenCalled()
    expect(orderModule.addOrderTransactions).not.toHaveBeenCalled()
  })

  it("clears a stale error and derives partial status after all request legs are reflected", async () => {
    const { container, query, orderModule } = setup(1, {}, {
      id: "order-1",
      metadata: {
        catalog_refund_request_id: "request-1",
        catalog_refund_status: "error",
        catalog_refund_error: "provider timeout",
        catalog_refund_plans: JSON.stringify({
          "request-1": {
            refunds: [
              { payment_id: "payment-1", amount: 100, currency_code: "rub" },
            ],
          },
        }),
      },
      payment_collections: [
        {
          payments: [
            {
              currency_code: "rub",
              captures: [{ amount: 1500 }],
              refunds: [{ amount: 100 }],
            },
          ],
        },
      ],
    })

    await invoke(input, { container })

    expect(query.graph).toHaveBeenCalledWith(expect.objectContaining({
      entity: "order",
      filters: { id: "order-1" },
    }))
    expect(orderModule.updateOrders).toHaveBeenCalledWith("order-1", {
      metadata: expect.objectContaining({
        catalog_refund_status: "partial",
        catalog_refund_error: null,
      }),
    })
  })

  it.each([
    [{ state: "declined_final" }, "финальному отказу"],
    [{ provider_operation_id: "other-refund" }, "другим ID провайдера"],
  ])("rejects conflicting operation markers before any writes %#", async (overrides, message) => {
    const { container, paymentModule, orderModule } = setup(1, overrides)

    await expect(invoke(input, { container })).rejects.toThrow(message)
    expect(paymentModule.createRefunds).not.toHaveBeenCalled()
    expect(paymentModule.updateRefunds).not.toHaveBeenCalled()
    expect(paymentModule.updatePayment).not.toHaveBeenCalled()
    expect(orderModule.addOrderTransactions).not.toHaveBeenCalled()
  })
})
