import { PaymentActions } from "@medusajs/framework/utils"

import RuntimeYooKassaService, {
  catalogPaymentIdempotencyKey,
  catalogRefundIdempotencyKey,
} from "../service"

type RuntimeConfig = {
  provider_id: string
  shop_id: string
  secret_key: string
  mode: "test" | "live"
  is_enabled: boolean
}

function runtimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    provider_id: "yookassa",
    shop_id: "shop-1",
    secret_key: "secret-1",
    mode: "test",
    is_enabled: true,
    ...overrides,
  }
}

function createProvider(
  configurations: RuntimeConfig[],
  paymentResult: (id: string) => Record<string, unknown> = (id) => ({
    id,
    status: "succeeded",
  })
) {
  const createdClients: Array<{ shopId: string; secretKey: string }> = []
  const getPayment = jest.fn(async (id: string) => paymentResult(id))
  const getRefund = jest.fn(async (id: string) => ({
    id,
    payment_id: "payment-1",
    status: "succeeded",
    amount: { value: "100.00", currency: "RUB" },
  }))
  const createPayment = jest.fn(async () => ({
    id: `payment-${createPayment.mock.calls.length}`,
    status: "pending",
  }))
  const createRefund = jest.fn().mockResolvedValue({ id: "refund-1" })
  const paymentOperation = {
    transitionPaymentOperation: jest.fn().mockResolvedValue({}),
  }
  let requestIndex = 0
  const paymentProviderConfig = {
    retrieveRuntimePaymentProviderConfig: jest.fn(async () => {
      const config = configurations[Math.min(requestIndex, configurations.length - 1)]
      requestIndex += 1
      return config
    }),
  }
  const logger = {
    debug: jest.fn(),
    warn: jest.fn(),
  }
  const provider = new RuntimeYooKassaService(
    { paymentProviderConfig, paymentOperation, logger } as never,
    { capture: true }
  )

  function RuntimeClient(options: { shopId: string; secretKey: string }) {
    createdClients.push(options)
    return {
      constructor: RuntimeClient,
      getPayment,
      getRefund,
      createPayment,
      createRefund,
    }
  }

  ;(provider as unknown as { yooCheckout_: unknown }).yooCheckout_ = {
    constructor: RuntimeClient,
  }

  return {
    provider,
    createdClients,
    getPayment,
    getRefund,
    createPayment,
    createRefund,
    paymentOperation,
    paymentProviderConfig,
  }
}

describe("runtime YooKassa provider", () => {
  it("authenticates refund.succeeded and returns the verified parent payment", async () => {
    const { provider, getRefund, getPayment } = createProvider(
      [runtimeConfig()],
      (id) => ({
        id,
        status: "succeeded",
        amount: { value: "1500.00", currency: "RUB" },
        refunded_amount: { value: "100.00", currency: "RUB" },
        metadata: { session_id: "payses_1" },
      })
    )

    const result = await provider.getWebhookActionAndData({
      data: { event: "refund.succeeded", object: { id: "refund-1" } },
    })

    expect(getRefund).toHaveBeenCalledWith("refund-1")
    expect(getPayment).toHaveBeenCalledWith("payment-1")
    expect(result).toEqual({
      action: PaymentActions.SUCCESSFUL,
      data: expect.objectContaining({
        refund_id: "refund-1",
        payment_id: "payment-1",
        amount: "100.00",
        currency_code: "rub",
        payment_session_id: "payses_1",
        payment_data: expect.objectContaining({
          id: "payment-1",
          refunded_amount: { value: "100.00", currency: "RUB" },
        }),
      }),
    })
  })

  it.each([
    [{ id: "refund-other", payment_id: "payment-1", status: "succeeded", amount: { value: "100", currency: "RUB" } }],
    [{ id: "refund-1", payment_id: "payment-1", status: "pending", amount: { value: "100", currency: "RUB" } }],
    [{ id: "refund-1", payment_id: "payment-1", status: "succeeded", amount: { value: "-1", currency: "RUB" } }],
  ])("rejects unverified or non-successful YooKassa refund data %#", async (refund) => {
    const { provider, getRefund, getPayment } = createProvider([runtimeConfig()])
    getRefund.mockResolvedValueOnce(refund as never)

    const result = await provider.getWebhookActionAndData({
      data: { event: "refund.succeeded", object: { id: "refund-1" } },
    })

    expect((result as { action?: unknown }).action).toBe(
      PaymentActions.NOT_SUPPORTED
    )
    expect(getPayment).not.toHaveBeenCalled()
  })

  it("uses the local refund ID for stable retries and distinct provider requests", () => {
    const firstAttempt = {
      amount: 500,
      data: { id: "payment-1", refunded_amount: { value: "0.00" } },
      context: { idempotency_key: "refund-local-1" },
    }
    const ambiguousRetry = {
      ...firstAttempt,
    }
    const distinctRefund = {
      ...firstAttempt,
      context: { idempotency_key: "refund-local-2" },
    }

    expect(catalogRefundIdempotencyKey(ambiguousRetry)).toBe(
      catalogRefundIdempotencyKey(firstAttempt)
    )
    expect(catalogRefundIdempotencyKey(distinctRefund)).not.toBe(
      catalogRefundIdempotencyKey(firstAttempt)
    )
    expect(() =>
      catalogRefundIdempotencyKey({ ...firstAttempt, context: {} })
    ).toThrow("Medusa refund id is required")
  })

  it("derives payment idempotency keys from the operation and payment payload", () => {
    const firstAttempt = {
      amount: 1500,
      currency_code: "rub",
      data: { payment_operation_id: "operation-1", session_id: "session-1" },
    }
    const ambiguousRetry = {
      ...firstAttempt,
      data: { payment_operation_id: "operation-1", session_id: "session-2" },
    }
    const nextAttempt = {
      ...firstAttempt,
      data: { payment_operation_id: "operation-2", session_id: "session-1" },
    }

    expect(catalogPaymentIdempotencyKey(ambiguousRetry)).toBe(
      catalogPaymentIdempotencyKey(firstAttempt)
    )
    expect(catalogPaymentIdempotencyKey(nextAttempt)).not.toBe(
      catalogPaymentIdempotencyKey(firstAttempt)
    )
    expect(() => catalogPaymentIdempotencyKey({ amount: 1500, currency_code: "rub" })).toThrow(
      "payment_operation_id is required"
    )
  })

  it("normalizes object payment amounts and distinguishes different values", () => {
    const input = {
      currency_code: "rub",
      data: { payment_operation_id: "operation-1" },
    }
    const key = catalogPaymentIdempotencyKey({ ...input, amount: 1500 })

    expect(catalogPaymentIdempotencyKey({ ...input, amount: { value: "1500" } })).toBe(key)
    expect(catalogPaymentIdempotencyKey({ ...input, amount: { numeric: 1500 } })).toBe(key)
    expect(catalogPaymentIdempotencyKey({ ...input, amount: { value: "1600" } })).not.toBe(key)
  })

  it("reuses the operation key when initiating again with a new session", async () => {
    const { provider, createPayment } = createProvider([runtimeConfig()])
    const input = {
      amount: { value: "1500" },
      currency_code: "rub",
      data: { payment_operation_id: "operation-1", session_id: "session-1" },
      context: { idempotency_key: "session-1" },
    }

    await provider.initiatePayment(input)
    await provider.initiatePayment({
      ...input,
      data: { ...input.data, session_id: "session-2" },
      context: { idempotency_key: "session-2" },
    })

    expect(createPayment).toHaveBeenCalledTimes(2)
    expect(createPayment.mock.calls.map((call) => call[1])).toEqual([
      catalogPaymentIdempotencyKey({ ...input, amount: 1500 }),
      catalogPaymentIdempotencyKey({ ...input, amount: 1500 }),
    ])
  })

  it("marks the operation result unknown when YooKassa initiation fails", async () => {
    const { provider, createPayment, paymentOperation } = createProvider([runtimeConfig()])
    const error = new Error("network unavailable")
    createPayment.mockRejectedValueOnce(error)

    await expect(
      provider.initiatePayment({
        amount: 1500,
        currency_code: "rub",
        data: { payment_operation_id: "operation-1" },
      })
    ).rejects.toThrow("network unavailable")

    expect(paymentOperation.transitionPaymentOperation).toHaveBeenCalledWith({
      operation_id: "operation-1",
      to_state: "result_unknown",
      source: "provider",
      action: "initiate",
      result: "error",
      error_category: "provider_error",
      error_reason: "An error occurred in initiatePayment: network unavailable",
    })
  })

  it("marks the operation result unknown when YooKassa initiation times out", async () => {
    jest.useFakeTimers()
    const { provider, createPayment, paymentOperation } = createProvider([runtimeConfig()])
    createPayment.mockImplementationOnce(() => new Promise(() => {}))

    try {
      const initiation = provider.initiatePayment({
        amount: 1500,
        currency_code: "rub",
        data: { payment_operation_id: "operation-timeout" },
      })
      const rejected = expect(initiation).rejects.toThrow(
        "ЮKassa не ответила за 30 секунд"
      )

      await jest.advanceTimersByTimeAsync(30_000)

      await rejected
      expect(paymentOperation.transitionPaymentOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_id: "operation-timeout",
          to_state: "result_unknown",
          source: "provider",
          action: "initiate",
          result: "error",
        })
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it("uses the unique Medusa refund ID and verifies the provider postcondition", async () => {
    const { provider, createRefund } = createProvider([runtimeConfig()], (id) => ({
      id,
      status: "succeeded",
      amount: { value: "1500.00", currency: "RUB" },
      refunded_amount: { value: "1500.00", currency: "RUB" },
      metadata: {},
    }))

    await expect(
      provider.refundPayment({
        amount: { value: "1500", precision: 20 },
        data: {
          id: "payment-1",
          amount: { value: "1500.00", currency: "RUB" },
          refunded_amount: { value: "0.00", currency: "RUB" },
          metadata: { receip_tmp: "{}" },
        },
        context: { idempotency_key: "new-local-refund-id" },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "payment-1",
          refunded_amount: expect.objectContaining({ value: "1500.00" }),
        }),
      })
    )
    expect(createRefund).toHaveBeenCalledTimes(1)
    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: "payment-1",
        amount: expect.objectContaining({ value: "1500" }),
      }),
      "new-local-refund-id"
    )
  })

  it("sends distinct YooKassa idempotency keys for separate refund rows", async () => {
    const { provider, createRefund, getPayment } = createProvider([runtimeConfig()])
    getPayment
      .mockResolvedValueOnce({
        id: "payment-1",
        refunded_amount: { value: "500.00", currency: "RUB" },
      })
      .mockResolvedValueOnce({
        id: "payment-1",
        refunded_amount: { value: "1000.00", currency: "RUB" },
      })

    await provider.refundPayment({
      amount: 500,
      data: {
        id: "payment-1",
        amount: { value: "1500.00", currency: "RUB" },
        refunded_amount: { value: "0.00", currency: "RUB" },
        metadata: { receip_tmp: "{}" },
      },
      context: { idempotency_key: "refund-local-1" },
    })
    await provider.refundPayment({
      amount: 500,
      data: {
        id: "payment-1",
        amount: { value: "1500.00", currency: "RUB" },
        refunded_amount: { value: "500.00", currency: "RUB" },
        metadata: { receip_tmp: "{}" },
      },
      context: { idempotency_key: "refund-local-2" },
    })

    expect(createRefund).toHaveBeenCalledTimes(2)
    expect(createRefund.mock.calls.map(([, idempotencyKey]) => idempotencyKey)).toEqual([
      "refund-local-1",
      "refund-local-2",
    ])
  })

  it("does not report a pending remote refund as completed", async () => {
    const { provider, createRefund } = createProvider([runtimeConfig()], (id) => ({
      id,
      status: "succeeded",
      amount: { value: "1500.00", currency: "RUB" },
      refunded_amount: { value: "0.00", currency: "RUB" },
      metadata: {},
    }))

    await expect(
      provider.refundPayment({
        amount: 1500,
        data: {
          id: "payment-1",
          amount: { value: "1500.00", currency: "RUB" },
          refunded_amount: { value: "0.00", currency: "RUB" },
          metadata: { receip_tmp: "{}" },
        },
        context: { idempotency_key: "local-refund-id" },
      })
    ).rejects.toThrow(
      "YooKassa не подтвердила завершение возврата: ожидалось 1500, подтверждено 0, ранее 0"
    )
    expect(createRefund).toHaveBeenCalledTimes(1)
  })

  it("rejects new payments while the provider is disabled", async () => {
    const { provider } = createProvider([
      runtimeConfig({ is_enabled: false }),
    ])

    await expect(
      provider.initiatePayment({
        currency_code: "rub",
        amount: 100,
        data: {},
        context: {},
      })
    ).rejects.toThrow("YooKassa is disabled for new payments")
  })

  it("continues status checks for existing sessions after disabling", async () => {
    const { provider } = createProvider([
      runtimeConfig({ is_enabled: false }),
    ])

    await expect(
      provider.getPaymentStatus({ data: { id: "payment-existing" } })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "captured",
        data: expect.objectContaining({ id: "payment-existing" }),
      })
    )
  })

  it("rebuilds the YooKassa client from storage on every operation", async () => {
    const { provider, createdClients } = createProvider([
      runtimeConfig({ shop_id: "shop-1", secret_key: "secret-1" }),
      runtimeConfig({ shop_id: "shop-2", secret_key: "secret-2" }),
    ])

    await provider.getPaymentStatus({ data: { id: "payment-1" } })
    await provider.getPaymentStatus({ data: { id: "payment-2" } })

    expect(createdClients).toEqual([
      { shopId: "shop-1", secretKey: "secret-1" },
      { shopId: "shop-2", secretKey: "secret-2" },
    ])
  })

  it("uses replaced credentials only for newly initiated operations", async () => {
    const { provider, createdClients, createPayment } = createProvider([
      runtimeConfig({ shop_id: "shop-1", secret_key: "secret-1" }),
      runtimeConfig({ shop_id: "shop-2", secret_key: "secret-2" }),
    ])

    const first = await provider.initiatePayment({
      currency_code: "rub",
      amount: 100,
      data: { payment_operation_id: "operation-1", session_id: "session-1" },
      context: { idempotency_key: "operation-1" },
    })
    const second = await provider.initiatePayment({
      currency_code: "rub",
      amount: 200,
      data: { payment_operation_id: "operation-2", session_id: "session-2" },
      context: { idempotency_key: "operation-2" },
    })

    expect(createdClients).toEqual([
      { shopId: "shop-1", secretKey: "secret-1" },
      { shopId: "shop-2", secretKey: "secret-2" },
    ])
    expect(first).toEqual(expect.objectContaining({ id: "payment-1" }))
    expect(second).toEqual(expect.objectContaining({ id: "payment-2" }))
    expect(createPayment).toHaveBeenCalledTimes(2)
    expect(createPayment.mock.calls.map((call) => call[1])).toEqual([
      catalogPaymentIdempotencyKey({
        amount: 100,
        currency_code: "rub",
        data: { payment_operation_id: "operation-1" },
      }),
      catalogPaymentIdempotencyKey({
        amount: 200,
        currency_code: "rub",
        data: { payment_operation_id: "operation-2" },
      }),
    ])
  })

  it("uses the current API status when the webhook event is stale", async () => {
    const { provider } = createProvider([runtimeConfig()], (id) => ({
      id,
      status: "succeeded",
      amount: { value: "1500.00" },
      metadata: { session_id: "payses_api" },
    }))

    await expect(
      provider.getWebhookActionAndData({
        data: {
          event: "payment.waiting_for_capture",
          object: { id: "payment-1" },
        },
      })
    ).resolves.toEqual({
      action: PaymentActions.SUCCESSFUL,
      data: { session_id: "payses_api", amount: "1500.00" },
    })
  })

  it("ignores webhook payment fields in favor of the API response", async () => {
    const { provider } = createProvider([runtimeConfig()], (id) => ({
      id,
      status: "canceled",
      amount: { value: "1499.00" },
      metadata: { session_id: "payses_api_truth" },
    }))

    await expect(
      provider.getWebhookActionAndData({
        data: {
          event: "payment.succeeded",
          object: {
            id: "payment-1",
            amount: { value: "1.00" },
            metadata: { session_id: "payses_tampered" },
          },
        },
      } as never)
    ).resolves.toEqual({
      action: PaymentActions.CANCELED,
      data: { session_id: "payses_api_truth", amount: "1499.00" },
    })
  })
})
