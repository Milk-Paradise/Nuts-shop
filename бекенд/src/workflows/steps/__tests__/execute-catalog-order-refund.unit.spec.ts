import {
  CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY,
  CATALOG_REFUND_ERROR_METADATA_KEY,
  CATALOG_REFUND_STATUS_METADATA_KEY,
  YOOKASSA_REFUND_ID_METADATA_KEY,
  executeCatalogOrderRefund,
} from "../execute-catalog-order-refund"

function refundRow(
  id: string,
  amount: number,
  operationId?: string,
  yookassaRefundId?: string
) {
  return {
    id,
    amount,
    ...(operationId || yookassaRefundId
      ? {
          metadata: {
            ...(operationId
              ? { [CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY]: operationId }
              : {}),
            ...(yookassaRefundId
              ? { [YOOKASSA_REFUND_ID_METADATA_KEY]: yookassaRefundId }
              : {}),
          },
        }
      : {}),
  }
}

function paymentData(
  refundedAmount: number,
  yookassaRefunds: Array<{
    id: string
    amount: string
    currency?: string
    status?: string
  }> = []
) {
  return {
    id: "yookassa_payment_test",
    amount: { value: "1500.00", currency: "RUB" },
    refunded_amount: {
      value: refundedAmount.toFixed(2),
      currency: "RUB",
    },
    yookassa_refunds: yookassaRefunds.map((refund) => ({
      currency: "RUB",
      status: "succeeded",
      ...refund,
    })),
  }
}

function paymentWithRefunds(
  refunds: Array<ReturnType<typeof refundRow>>,
  refundedAmount: number,
  yookassaRefunds: Parameters<typeof paymentData>[1] = []
) {
  return {
    id: "pay_test",
    provider_id: "pp_yookassa_yookassa",
    currency_code: "rub",
    data: paymentData(refundedAmount, yookassaRefunds),
    refunds,
  }
}

function setup(
  refundPayment: jest.Mock,
  completedRefunds: Array<ReturnType<typeof refundRow>> = [],
  refundedAmount = 0
) {
  const paymentModule = {
    refundPayment,
    retrievePayment: jest
      .fn()
      .mockResolvedValue(paymentWithRefunds(completedRefunds, refundedAmount)),
  }
  const operationModule = {
    claimPaymentOperation: jest.fn().mockResolvedValue({
      operation: { id: "op_refund", state: "processing" },
      created: true,
    }),
    retrievePaymentOperation: jest.fn().mockResolvedValue({
      id: "op_refund",
      state: "processing",
      provider_operation_id: null,
    }),
    listPaymentOperations: jest.fn().mockResolvedValue([]),
    transitionPaymentOperation: jest.fn().mockResolvedValue({ applied: true }),
    markPaymentOperationResultReflected: jest.fn().mockResolvedValue({ applied: true }),
  }
  const orderModule = {
    retrieveOrder: jest.fn().mockResolvedValue({
      id: "order_test",
      metadata: { keep: "value" },
    }),
    listOrderTransactions: jest.fn().mockResolvedValue([]),
    addOrderTransactions: jest.fn().mockResolvedValue({ id: "trx_refund" }),
    updateOrders: jest.fn().mockResolvedValue({ id: "order_test" }),
  }
  const locking = {
    execute: jest.fn(async (_key: string, callback: () => Promise<unknown>) =>
      callback()
    ),
  }
  const container = {
    resolve: jest.fn((key: string) =>
      key === "payment"
        ? paymentModule
        : key === "paymentOperation"
          ? operationModule
          : key === "locking"
            ? locking
            : orderModule
    ),
  }
  const input = {
    order_id: "order_test",
    refunds: [
      {
        payment_id: "pay_test",
        amount: 1500,
        currency_code: "rub",
        note: "Возврат",
      },
    ],
  }

  return {
    container: container as any,
    input,
    orderModule,
    paymentModule,
    operationModule,
    locking,
  }
}

describe("executeCatalogOrderRefund", () => {
  it("records a successful provider refund and clears a previous error", async () => {
    const refundPayment = jest.fn().mockResolvedValue(
      paymentWithRefunds([refundRow("refund_test", 1500, "op_refund")], 1500)
    )
    const { container, input, orderModule, operationModule, locking } = setup(refundPayment)

    await expect(executeCatalogOrderRefund(container, input)).resolves.toEqual({
      status: "refunded",
      error: null,
    })
    expect(orderModule.addOrderTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: "order_test",
        amount: -1500,
        reference: "refund",
        reference_id: "refund_test",
      })
    )
    expect(orderModule.updateOrders).toHaveBeenCalledWith(
      "order_test",
      expect.objectContaining({
        metadata: expect.objectContaining({
          keep: "value",
          [CATALOG_REFUND_STATUS_METADATA_KEY]: "refunded",
          [CATALOG_REFUND_ERROR_METADATA_KEY]: null,
        }),
      })
    )
    expect(operationModule.claimPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: "payment-action:pay_test" })
    )
    expect(refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          [CATALOG_PAYMENT_OPERATION_ID_METADATA_KEY]: "op_refund",
        },
      })
    )
    expect(locking.execute).toHaveBeenCalledWith(
      "catalog-yookassa-refund:pay_test",
      expect.any(Function),
      { timeout: 300 }
    )
    expect(locking.execute).toHaveBeenCalledWith(
      "catalog-order-refund-ledger:order_test:refund_test",
      expect.any(Function)
    )
  })

  it("records every partial refund with its own ledger reference", async () => {
    const completedRefunds = [
      refundRow("refund_first", 500, "op_first"),
      refundRow("refund_second", 1000, "op_refund"),
    ]
    const refundPayment = jest
      .fn()
      .mockResolvedValue(paymentWithRefunds(completedRefunds, 1500))
    const { container, orderModule } = setup(
      refundPayment,
      completedRefunds
    )

    await executeCatalogOrderRefund(container, {
      order_id: "order_test",
      refunds: [
        {
          payment_id: "pay_test",
          amount: 1000,
          currency_code: "rub",
        },
      ],
    })

    expect(orderModule.addOrderTransactions).toHaveBeenCalledTimes(2)
    expect(orderModule.addOrderTransactions).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ reference_id: "refund_first", amount: -500 })
    )
    expect(orderModule.addOrderTransactions).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reference_id: "refund_second", amount: -1000 })
    )
  })

  it("does not call the provider again for an already completed refund", async () => {
    const refundPayment = jest.fn()
    const { container, input, operationModule } = setup(
      refundPayment,
      [refundRow("refund_test", 1500, "op_refund")],
      1500
    )
    operationModule.claimPaymentOperation.mockResolvedValue({
      operation: {
        id: "op_refund",
        state: "completed",
        provider_operation_id: "refund_test",
      },
      created: false,
    })

    await expect(executeCatalogOrderRefund(container, input)).resolves.toMatchObject({
      status: "refunded",
    })
    expect(refundPayment).not.toHaveBeenCalled()
    expect(operationModule.transitionPaymentOperation).not.toHaveBeenCalled()
  })

  it("does not retry an unknown provider result without an exact linked refund", async () => {
    const refundPayment = jest.fn()
    const { container, input, operationModule } = setup(refundPayment)
    operationModule.claimPaymentOperation.mockResolvedValue({
      operation: { id: "op_refund", state: "result_unknown" },
      created: false,
    })

    await expect(executeCatalogOrderRefund(container, input)).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("точной записью ЮKassa"),
    })
    expect(refundPayment).not.toHaveBeenCalled()
    expect(operationModule.transitionPaymentOperation).not.toHaveBeenCalled()
  })

  it("does not treat an aggregate increase as proof for an unknown refund", async () => {
    const refundPayment = jest.fn()
    const { container, input, paymentModule, operationModule } = setup(refundPayment)
    paymentModule.retrievePayment.mockResolvedValue(
      paymentWithRefunds([refundRow("refund_ambiguous", 1500, "op_refund")], 1500)
    )
    operationModule.claimPaymentOperation.mockResolvedValue({
      operation: { id: "op_refund", state: "result_unknown" },
      created: false,
    })

    await expect(executeCatalogOrderRefund(container, input)).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("Нет подтверждения точного возврата"),
    })

    expect(refundPayment).not.toHaveBeenCalled()
    expect(operationModule.transitionPaymentOperation).not.toHaveBeenCalled()
  })

  it("blocks a different request while another refund operation is unresolved", async () => {
    const refundPayment = jest.fn()
    const { container, input, orderModule, operationModule } = setup(refundPayment)
    operationModule.listPaymentOperations.mockResolvedValue([
      {
        id: "op_other_refund",
        state: "result_unknown",
      },
    ])

    await expect(executeCatalogOrderRefund(container, input)).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("уже есть незавершённый возврат"),
    })

    expect(refundPayment).not.toHaveBeenCalled()
    expect(operationModule.transitionPaymentOperation).not.toHaveBeenCalled()
    expect(orderModule.addOrderTransactions).not.toHaveBeenCalled()
    expect(operationModule.claimPaymentOperation).not.toHaveBeenCalled()
  })

  it("waits for the YooKassa ID before starting a same-amount refund", async () => {
    const refundPayment = jest.fn()
    const priorRefund = refundRow("refund_prior", 1500, "op_prior")
    const { container, input, operationModule } = setup(
      refundPayment,
      [priorRefund],
      1500
    )
    operationModule.listPaymentOperations.mockResolvedValue([
      {
        id: "op_prior",
        state: "completed",
        idempotency_key: "refund-request:prior:pay_test",
        amount: 1500,
        currency_code: "rub",
      },
    ])

    await expect(executeCatalogOrderRefund(container, input)).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("требуется сверка"),
    })

    expect(operationModule.claimPaymentOperation).not.toHaveBeenCalled()
    expect(refundPayment).not.toHaveBeenCalled()
    expect(operationModule.transitionPaymentOperation).not.toHaveBeenCalled()
  })

  it("recovers a saved refund after the operation transition failed without calling the provider again", async () => {
    const persistedPayment = paymentWithRefunds(
      [refundRow("refund_persisted", 1500, "op_refund", "yk_refund_1")],
      1500,
      [{ id: "yk_refund_1", amount: "1500.00" }]
    )
    const refundPayment = jest.fn().mockResolvedValue(persistedPayment)
    const { container, input, orderModule, paymentModule, operationModule } =
      setup(refundPayment)
    paymentModule.retrievePayment
      .mockResolvedValueOnce(paymentWithRefunds([], 0))
      .mockResolvedValueOnce(persistedPayment)
    operationModule.claimPaymentOperation
      .mockResolvedValueOnce({
        operation: { id: "op_refund", state: "processing" },
        created: true,
      })
      .mockResolvedValue({
        operation: { id: "op_refund", state: "processing" },
        created: false,
      })
    operationModule.transitionPaymentOperation
      .mockRejectedValueOnce(new Error("temporary state write failure"))
      .mockResolvedValue({ applied: true })

    await expect(executeCatalogOrderRefund(container, input)).resolves.toEqual({
      status: "error",
      error: "temporary state write failure",
    })
    await expect(executeCatalogOrderRefund(container, input)).resolves.toEqual({
      status: "refunded",
      error: null,
    })

    expect(refundPayment).toHaveBeenCalledTimes(1)
    expect(operationModule.transitionPaymentOperation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation_id: "op_refund",
        to_state: "completed",
        source: "reconciliation",
        action: "refund_reconciled",
        provider_operation_id: "yk_refund_1",
      })
    )
    expect(orderModule.addOrderTransactions).toHaveBeenCalledTimes(1)
    expect(orderModule.addOrderTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        reference_id: "refund_persisted",
        amount: -1500,
      })
    )
    expect(operationModule.markPaymentOperationResultReflected).toHaveBeenCalledWith({
      operation_id: "op_refund",
      order_id: "order_test",
    })
  })

  it("recovers an exact webhook refund when a later payment update replaced the history array", async () => {
    const paymentAfterProviderUpdate = paymentWithRefunds(
      [refundRow("refund_persisted", 1500, "op_refund", "yk_refund_1")],
      1500,
      []
    )
    const refundPayment = jest.fn()
    const { container, input, paymentModule, operationModule } = setup(refundPayment)
    paymentModule.retrievePayment.mockResolvedValue(paymentAfterProviderUpdate)
    operationModule.claimPaymentOperation.mockResolvedValue({
      operation: {
        id: "op_refund",
        state: "result_unknown",
        provider_operation_id: "yk_refund_1",
      },
      created: false,
    })

    await expect(executeCatalogOrderRefund(container, input)).resolves.toEqual({
      status: "refunded",
      error: null,
    })

    expect(refundPayment).not.toHaveBeenCalled()
    expect(operationModule.transitionPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: "op_refund",
        to_state: "completed",
        provider_operation_id: "yk_refund_1",
      })
    )
  })

  it("accepts a webhook completion race only for the exact linked refund", async () => {
    const webhookCompletedPayment = paymentWithRefunds(
      [refundRow("refund_race", 1500, "op_refund", "yk_refund_race")],
      1500,
      [{ id: "yk_refund_race", amount: "1500.00" }]
    )
    const refundPayment = jest.fn().mockResolvedValue(webhookCompletedPayment)
    const { container, input, orderModule, paymentModule, operationModule } =
      setup(refundPayment)
    paymentModule.retrievePayment
      .mockResolvedValueOnce(paymentWithRefunds([], 0))
      .mockResolvedValueOnce(webhookCompletedPayment)
    operationModule.retrievePaymentOperation.mockResolvedValue({
      id: "op_refund",
      state: "completed",
      provider_operation_id: "yk_refund_race",
    })

    await expect(executeCatalogOrderRefund(container, input)).resolves.toMatchObject({
      status: "refunded",
    })

    expect(operationModule.transitionPaymentOperation).not.toHaveBeenCalled()
    expect(orderModule.addOrderTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: "refund",
        reference_id: "refund_race",
        amount: -1500,
      })
    )
    expect(operationModule.markPaymentOperationResultReflected).toHaveBeenCalledWith({
      operation_id: "op_refund",
      order_id: "order_test",
    })
  })

  it("accepts an exact webhook completion after the operation transition loses the race", async () => {
    const webhookCompletedPayment = paymentWithRefunds(
      [refundRow("refund_race_late", 1500, "op_refund", "yk_refund_late")],
      1500,
      [{ id: "yk_refund_late", amount: "1500.00" }]
    )
    const refundPayment = jest.fn().mockResolvedValue(webhookCompletedPayment)
    const { container, input, orderModule, paymentModule, operationModule } =
      setup(refundPayment)
    paymentModule.retrievePayment
      .mockResolvedValueOnce(paymentWithRefunds([], 0))
      .mockResolvedValueOnce(webhookCompletedPayment)
    operationModule.retrievePaymentOperation
      .mockResolvedValueOnce({
        id: "op_refund",
        state: "processing",
        provider_operation_id: null,
      })
      .mockResolvedValueOnce({
        id: "op_refund",
        state: "completed",
        provider_operation_id: "yk_refund_late",
      })
    operationModule.transitionPaymentOperation.mockRejectedValueOnce(
      new Error("webhook completed the operation first")
    )

    await expect(executeCatalogOrderRefund(container, input)).resolves.toMatchObject({
      status: "refunded",
    })

    expect(operationModule.transitionPaymentOperation).toHaveBeenCalledTimes(1)
    expect(orderModule.addOrderTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        reference_id: "refund_race_late",
        amount: -1500,
      })
    )
    expect(operationModule.markPaymentOperationResultReflected).toHaveBeenCalledWith({
      operation_id: "op_refund",
      order_id: "order_test",
    })
  })

  it("rejects a webhook completion race correlated to a different refund", async () => {
    const unrelatedPayment = paymentWithRefunds(
      [refundRow("refund_local", 1500, "op_refund")],
      1500
    )
    const refundPayment = jest.fn().mockResolvedValue(unrelatedPayment)
    const { container, input, orderModule, paymentModule, operationModule } =
      setup(refundPayment)
    paymentModule.retrievePayment
      .mockResolvedValueOnce(paymentWithRefunds([], 0))
      .mockResolvedValueOnce(unrelatedPayment)
    operationModule.retrievePaymentOperation.mockResolvedValue({
      id: "op_refund",
      state: "completed",
      provider_operation_id: "another-refund",
    })

    await expect(executeCatalogOrderRefund(container, input)).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("другим возвратом"),
    })

    expect(operationModule.transitionPaymentOperation).not.toHaveBeenCalled()
    expect(orderModule.addOrderTransactions).not.toHaveBeenCalled()
    expect(operationModule.markPaymentOperationResultReflected).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: "refund marker is missing",
      refunds: [],
      remoteRefundedAmount: 0,
    },
    {
      label: "refund amount does not match",
      refunds: [refundRow("refund_mismatch", 1400, "op_refund")],
      remoteRefundedAmount: 1400,
    },
    {
      label: "provider refunded amount is stale",
      refunds: [refundRow("refund_stale", 1500, "op_refund", "yk_refund_stale")],
      remoteRefundedAmount: 1400,
    },
    {
      label: "aggregate increase has no exact refund record",
      refunds: [refundRow("refund_unrelated", 1500, "op_refund")],
      remoteRefundedAmount: 1500,
    },
  ])("fails closed when a repeated operation has a $label", async ({
    refunds,
    remoteRefundedAmount,
  }) => {
    const refundPayment = jest.fn()
    const { container, input, orderModule, paymentModule, operationModule } =
      setup(refundPayment)
    paymentModule.retrievePayment.mockResolvedValue(
      paymentWithRefunds(refunds, remoteRefundedAmount)
    )
    operationModule.claimPaymentOperation.mockResolvedValue({
      operation: { id: "op_refund", state: "processing" },
      created: false,
    })

    await expect(executeCatalogOrderRefund(container, input)).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("сверка"),
    })

    expect(refundPayment).not.toHaveBeenCalled()
    expect(operationModule.transitionPaymentOperation).not.toHaveBeenCalled()
    expect(orderModule.addOrderTransactions).not.toHaveBeenCalled()
    expect(orderModule.updateOrders).toHaveBeenCalledWith(
      "order_test",
      expect.objectContaining({
        metadata: expect.objectContaining({
          [CATALOG_REFUND_STATUS_METADATA_KEY]: "error",
        }),
      })
    )
  })

  it("persists the provider error without creating a refund transaction", async () => {
    const refundPayment = jest
      .fn()
      .mockRejectedValue(new Error("provider rate limit"))
    const { container, input, orderModule } = setup(refundPayment)

    await expect(executeCatalogOrderRefund(container, input)).resolves.toEqual({
      status: "error",
      error: "provider rate limit",
    })
    expect(orderModule.addOrderTransactions).not.toHaveBeenCalled()
    expect(orderModule.updateOrders).toHaveBeenCalledWith(
      "order_test",
      expect.objectContaining({
        metadata: expect.objectContaining({
          [CATALOG_REFUND_STATUS_METADATA_KEY]: "error",
          [CATALOG_REFUND_ERROR_METADATA_KEY]: "provider rate limit",
        }),
      })
    )
  })
})
