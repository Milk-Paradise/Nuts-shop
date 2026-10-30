jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: string, invoke: unknown) => invoke,
  StepResponse: class StepResponse<T> {
    constructor(readonly result: T) {}
  },
}))

import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import { checkCatalogPaymentStatusStep } from "../check-catalog-payment-status"
import { verifyCatalogPaymentWebhookStep } from "../verify-catalog-payment-webhook"

function operationService(state = "processing") {
  return {
    claimPaymentOperation: jest.fn().mockResolvedValue({
      operation: { id: "op-1", state },
      created: true,
    }),
    retrievePaymentOperation: jest.fn().mockResolvedValue({ id: "op-1", state }),
    transitionPaymentOperation: jest.fn().mockResolvedValue({ applied: true }),
  }
}

function containerWith(service: unknown, operations = operationService()) {
  return {
    resolve: jest.fn((key: string) =>
      key === "paymentOperation"
        ? operations
        : key === "logger"
          ? { error: jest.fn() }
          : service
    ),
  } as any
}

function paymentService(overrides: Record<string, unknown> = {}) {
  const session = {
    id: "session-1",
    provider_id: "pp_yookassa_yookassa",
    amount: 1500,
    currency_code: "rub",
    data: { id: "provider-payment-1" },
    payment: null,
  }
  return {
    retrievePaymentSession: jest.fn().mockResolvedValue(session),
    paymentProviderService_: {
      getStatus: jest.fn().mockResolvedValue({
        status: PaymentSessionStatus.PENDING,
        data: { id: "provider-payment-1", amount: { value: "1500", currency: "RUB" } },
      }),
    },
    updatePaymentSession: jest.fn().mockResolvedValue({}),
    authorizePaymentSession: jest.fn(),
    capturePayment: jest.fn(),
    retrievePayment: jest.fn(),
    ...overrides,
  }
}

describe("checkCatalogPaymentStatusStep", () => {
  const invoke = checkCatalogPaymentStatusStep as any

  it("returns pending after persisting verified provider state", async () => {
    const service = paymentService()
    const response = await invoke({ payment_session_id: "session-1" }, { container: containerWith(service) })
    expect(response.result).toEqual({ status: "pending", operation_id: "op-1", payment: null })
    expect(service.updatePaymentSession).toHaveBeenCalledWith(expect.objectContaining({ status: PaymentSessionStatus.PENDING }))
  })

  it("claims legacy sessions with the existing session idempotency key", async () => {
    const service = paymentService()
    const operations = operationService()

    await invoke(
      { payment_session_id: "session-1" },
      { container: containerWith(service, operations) }
    )

    expect(operations.claimPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency_key: "payment:session-1",
        action: "status_check",
      })
    )
    expect(operations.retrievePaymentOperation).not.toHaveBeenCalled()
  })

  it("uses the linked operation for a captured payment", async () => {
    const service = paymentService()
    service.paymentProviderService_.getStatus.mockResolvedValue({
      status: PaymentSessionStatus.CAPTURED,
      data: { id: "provider-payment-1", amount: { value: 1500, currency: "rub" } },
    })
    service.retrievePaymentSession
      .mockResolvedValueOnce({
        id: "session-1", provider_id: "provider", amount: 1500, currency_code: "rub",
        data: { id: "provider-payment-1", payment_operation_id: "op-initiate-1" }, payment: null,
      })
      .mockResolvedValueOnce({ payment: null })
    service.authorizePaymentSession.mockResolvedValue({ id: "payment-1" })
    service.retrievePayment.mockResolvedValue({
      id: "payment-1", currency_code: "rub", captured_at: new Date(),
      captures: [{ id: "capture-1", amount: 1500 }],
    })
    const operations = operationService()
    operations.retrievePaymentOperation.mockResolvedValue({ id: "op-initiate-1", state: "processing" })

    const response = await invoke(
      { payment_session_id: "session-1" },
      { container: containerWith(service, operations) }
    )

    expect(response.result).toMatchObject({ status: "succeeded", operation_id: "op-initiate-1" })
    expect(operations.retrievePaymentOperation).toHaveBeenCalledWith("op-initiate-1")
    expect(operations.claimPaymentOperation).not.toHaveBeenCalled()
    expect(operations.transitionPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation_id: "op-initiate-1", to_state: "completed" })
    )
  })

  it("uses the linked operation for a canceled payment", async () => {
    const service = paymentService({
      retrievePaymentSession: jest.fn().mockResolvedValue({
        id: "session-1", provider_id: "provider", amount: 1500, currency_code: "rub",
        data: { id: "provider-payment-1", payment_operation_id: "op-initiate-1" }, payment: null,
      }),
    })
    service.paymentProviderService_.getStatus.mockResolvedValue({
      status: PaymentSessionStatus.CANCELED,
      data: { id: "provider-payment-1", amount: { value: 1500, currency: "rub" } },
    })
    const operations = operationService()
    operations.retrievePaymentOperation.mockResolvedValue({ id: "op-initiate-1", state: "processing" })

    const response = await invoke(
      { payment_session_id: "session-1" },
      { container: containerWith(service, operations) }
    )

    expect(response.result).toEqual({ status: "failed", operation_id: "op-initiate-1", payment: null })
    expect(operations.retrievePaymentOperation).toHaveBeenCalledWith("op-initiate-1")
    expect(operations.claimPaymentOperation).not.toHaveBeenCalled()
    expect(operations.transitionPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation_id: "op-initiate-1", to_state: "declined_final" })
    )
  })

  it("records a provider error against the linked operation", async () => {
    const service = paymentService({
      retrievePaymentSession: jest.fn().mockResolvedValue({
        id: "session-1", provider_id: "provider", amount: 1500, currency_code: "rub",
        data: { id: "provider-payment-1", payment_operation_id: "op-initiate-1" }, payment: null,
      }),
    })
    service.paymentProviderService_.getStatus.mockRejectedValue(new Error("provider unavailable"))
    const operations = operationService()
    operations.retrievePaymentOperation.mockResolvedValue({ id: "op-initiate-1", state: "processing" })

    await expect(
      invoke({ payment_session_id: "session-1" }, { container: containerWith(service, operations) })
    ).rejects.toThrow("provider unavailable")

    expect(operations.retrievePaymentOperation).toHaveBeenCalledWith("op-initiate-1")
    expect(operations.claimPaymentOperation).not.toHaveBeenCalled()
    expect(operations.transitionPaymentOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation_id: "op-initiate-1", to_state: "result_unknown" })
    )
  })

  it("returns failed for a canceled provider payment", async () => {
    const service = paymentService()
    service.paymentProviderService_.getStatus.mockResolvedValue({
      status: PaymentSessionStatus.CANCELED,
      data: { id: "provider-payment-1", amount: { value: 1500, currency: "rub" } },
    })
    const response = await invoke({ payment_session_id: "session-1" }, { container: containerWith(service) })
    expect(response.result).toEqual({ status: "failed", operation_id: "op-1", payment: null })
  })

  it.each([
    [{ id: "wrong", amount: { value: 1500, currency: "rub" } }],
    [{ id: "provider-payment-1", amount: { value: "bad", currency: "rub" } }],
    [{ id: "provider-payment-1", amount: { value: 1501, currency: "rub" } }],
    [{ id: "provider-payment-1", amount: { value: 1500, currency: "usd" } }],
  ])("rejects provider data that does not match the session", async (data) => {
    const service = paymentService()
    service.paymentProviderService_.getStatus.mockResolvedValue({ status: PaymentSessionStatus.PENDING, data })
    await expect(invoke({ payment_session_id: "session-1" }, { container: containerWith(service) })).rejects.toThrow("не совпадают")
  })

  it("authorizes a captured session and returns persisted captures", async () => {
    const service = paymentService()
    service.paymentProviderService_.getStatus.mockResolvedValue({
      status: PaymentSessionStatus.CAPTURED,
      data: { id: "provider-payment-1", amount: { value: 1500, currency: "rub" } },
    })
    service.retrievePaymentSession
      .mockResolvedValueOnce({
        id: "session-1", provider_id: "provider", amount: 1500, currency_code: "rub",
        data: { id: "provider-payment-1" }, payment: null,
      })
      .mockResolvedValueOnce({ payment: null })
    service.authorizePaymentSession.mockResolvedValue({ id: "payment-1" })
    service.retrievePayment.mockResolvedValue({
      id: "payment-1", currency_code: "rub", captured_at: new Date(),
      captures: [{ id: "capture-1", amount: 1500 }],
    })

    const response = await invoke({ payment_session_id: "session-1" }, { container: containerWith(service) })
    expect(response.result).toEqual({
      status: "succeeded",
      operation_id: "op-1",
      payment: { id: "payment-1", currency_code: "rub", captures: [{ id: "capture-1", amount: 1500 }] },
    })
  })

  it("does not create a second result for repeated confirmation", async () => {
    const service = paymentService({
      retrievePaymentSession: jest.fn()
        .mockResolvedValueOnce({
          id: "session-1", provider_id: "provider", amount: 1500,
          currency_code: "rub", data: { id: "provider-payment-1" },
        })
        .mockResolvedValueOnce({ payment: { id: "payment-1" } }),
      retrievePayment: jest.fn().mockResolvedValue({
        id: "payment-1", currency_code: "rub", captured_at: new Date(),
        captures: [{ id: "capture-1", amount: 1500 }],
      }),
    })
    const operations = operationService("completed")

    const response = await invoke(
      { payment_session_id: "session-1", external_event_key: "event-1" },
      { container: containerWith(service, operations) }
    )

    expect(response.result.status).toBe("succeeded")
    expect(service.paymentProviderService_.getStatus).not.toHaveBeenCalled()
    expect(service.authorizePaymentSession).not.toHaveBeenCalled()
    expect(service.capturePayment).not.toHaveBeenCalled()
    expect(operations.transitionPaymentOperation).not.toHaveBeenCalled()
  })

  it("recovers after confirmation without creating a new payment", async () => {
    const capturedPayment = {
      id: "payment-1",
      currency_code: "rub",
      captured_at: new Date(),
      captures: [{ id: "capture-1", amount: 1500 }],
    }
    const session = {
      id: "session-1",
      provider_id: "provider",
      amount: 1500,
      currency_code: "rub",
      data: { id: "provider-payment-1" },
    }
    const service = paymentService({
      retrievePaymentSession: jest.fn()
        .mockResolvedValueOnce({ ...session, payment: null })
        .mockResolvedValueOnce({ payment: null })
        .mockResolvedValueOnce({ ...session, payment: capturedPayment })
        .mockResolvedValueOnce({ payment: capturedPayment }),
      authorizePaymentSession: jest.fn().mockResolvedValue(capturedPayment),
      retrievePayment: jest.fn().mockResolvedValue(capturedPayment),
    })
    service.paymentProviderService_.getStatus.mockResolvedValue({
      status: PaymentSessionStatus.CAPTURED,
      data: {
        id: "provider-payment-1",
        amount: { value: 1500, currency: "rub" },
      },
    })
    const operations = operationService()
    operations.claimPaymentOperation
      .mockResolvedValueOnce({
        operation: { id: "op-1", state: "processing" },
        created: true,
      })
      .mockResolvedValueOnce({
        operation: { id: "op-1", state: "completed" },
        created: false,
      })

    await invoke(
      { payment_session_id: "session-1" },
      { container: containerWith(service, operations) }
    )
    const recovered = await invoke(
      { payment_session_id: "session-1" },
      { container: containerWith(service, operations) }
    )

    expect(recovered.result).toMatchObject({
      status: "succeeded",
      operation_id: "op-1",
      payment: { id: "payment-1" },
    })
    expect(service.paymentProviderService_.getStatus).toHaveBeenCalledTimes(1)
    expect(service.authorizePaymentSession).toHaveBeenCalledTimes(1)
    expect(operations.transitionPaymentOperation).toHaveBeenCalledTimes(1)
  })

  it("captures an existing authorized payment", async () => {
    const service = paymentService()
    service.paymentProviderService_.getStatus.mockResolvedValue({
      status: PaymentSessionStatus.CAPTURED,
      data: { id: "provider-payment-1", amount: { value: 1500, currency: "rub" } },
    })
    service.retrievePaymentSession
      .mockResolvedValueOnce({ id: "session-1", provider_id: "provider", amount: 1500, currency_code: "rub", data: { id: "provider-payment-1" } })
      .mockResolvedValueOnce({ payment: { id: "payment-1", captured_at: null } })
    service.retrievePayment.mockResolvedValue({ id: "payment-1", currency_code: "rub", captured_at: new Date(), captures: [{ id: "capture-1", amount: 1500 }] })
    await invoke({ payment_session_id: "session-1" }, { container: containerWith(service) })
    expect(service.capturePayment).toHaveBeenCalledWith(expect.objectContaining({ payment_id: "payment-1", is_captured: true }))
  })

  it("rejects a captured status without a durable captured payment", async () => {
    const service = paymentService()
    service.paymentProviderService_.getStatus.mockResolvedValue({
      status: PaymentSessionStatus.CAPTURED,
      data: { id: "provider-payment-1", amount: { value: 1500, currency: "rub" } },
    })
    service.retrievePaymentSession
      .mockResolvedValueOnce({ id: "session-1", provider_id: "provider", amount: 1500, currency_code: "rub", data: { id: "provider-payment-1" } })
      .mockResolvedValueOnce({ payment: { id: "payment-1", captured_at: new Date() } })
    service.retrievePayment.mockResolvedValue({ id: "payment-1", captured_at: null, captures: [] })
    await expect(invoke({ payment_session_id: "session-1" }, { container: containerWith(service) })).rejects.toThrow("не отмечен")
  })
})

describe("verifyCatalogPaymentWebhookStep", () => {
  const invoke = verifyCatalogPaymentWebhookStep as any
  const input = { provider: "yookassa", body: { event: "payment.succeeded" }, raw_data_base64: Buffer.from("raw").toString("base64"), headers: { signature: "test" } }

  it("returns only verified action data and decodes the raw body", async () => {
    const service = { getWebhookActionAndData: jest.fn().mockResolvedValue({ action: PaymentActions.SUCCESSFUL, data: { session_id: "session-1", amount: 1500 } }) }
    const response = await invoke(input, { container: containerWith(service) })
    expect(response.result).toEqual({ action: PaymentActions.SUCCESSFUL, amount: 1500, session_id: "session-1" })
    expect(service.getWebhookActionAndData.mock.calls[0][0].payload.rawData.toString()).toBe("raw")
  })

  it.each([
    [{ action: PaymentActions.NOT_SUPPORTED, data: { session_id: "session-1" } }],
    [{ action: PaymentActions.SUCCESSFUL, data: {} }],
  ])("rejects unverifiable webhooks", async (result) => {
    const service = { getWebhookActionAndData: jest.fn().mockResolvedValue(result) }
    await expect(invoke(input, { container: containerWith(service) })).rejects.toThrow("could not be verified")
  })
})
