const mockVerifyWebhookRun = jest.fn()
const mockRefundWebhookRun = jest.fn()

jest.mock("../../../../../workflows/verify-catalog-payment-webhook", () => ({
  verifyCatalogPaymentWebhookWorkflow: () => ({ run: mockVerifyWebhookRun }),
}))
jest.mock("../../../../../workflows/reconcile-catalog-refund-webhook", () => ({
  reconcileCatalogRefundWebhookWorkflow: () => ({ run: mockRefundWebhookRun }),
}))

import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { POST } from "../route"

function response() {
  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  }
  return res
}

function request(overrides: Record<string, unknown> = {}) {
  const logger = { error: jest.fn(), warn: jest.fn() }
  const scope = {
    resolve: jest.fn((key) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      throw new Error(`Unexpected dependency: ${String(key)}`)
    }),
  }
  return {
    req: {
      scope,
      socket: { remoteAddress: "185.71.76.1" },
      headers: {},
      body: { event: "payment.succeeded", object: { id: "payment_1" } },
      ...overrides,
    } as any,
    logger,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyWebhookRun.mockResolvedValue({ result: { session_id: "payses_1" } })
  mockRefundWebhookRun.mockResolvedValue({ result: { refund_id: "refund_1" } })
})

it("rejects untrusted source IPs before parsing or running the workflow", async () => {
  const { req, logger } = request({ socket: { remoteAddress: "203.0.113.10" } })
  const res = response()
  await POST(req, res)
  expect(res.status).toHaveBeenCalledWith(403)
  expect(mockVerifyWebhookRun).not.toHaveBeenCalled()
  expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("untrusted source IP"))
})

it("accepts the official source IP forwarded by an explicitly trusted proxy", async () => {
  const previousTrustedNetworks = process.env.YOOKASSA_WEBHOOK_TRUSTED_PROXY_CIDRS
  process.env.YOOKASSA_WEBHOOK_TRUSTED_PROXY_CIDRS = "10.0.1.3/32"
  const { req } = request({
    socket: { remoteAddress: "10.0.1.3" },
    headers: { "x-real-ip": "77.75.156.11" },
  })
  const res = response()

  try {
    await POST(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mockVerifyWebhookRun).toHaveBeenCalledTimes(1)
  } finally {
    if (previousTrustedNetworks === undefined) {
      delete process.env.YOOKASSA_WEBHOOK_TRUSTED_PROXY_CIDRS
    } else {
      process.env.YOOKASSA_WEBHOOK_TRUSTED_PROXY_CIDRS = previousTrustedNetworks
    }
  }
})

it.each([
  {},
  { event: "", object: { id: "payment_1" } },
  { event: 1, object: { id: "payment_1" } },
  { event: "payment.succeeded", object: {} },
  { event: "payment.succeeded", object: { id: 1 } },
])("rejects an unverifiable payload %#", async (body) => {
  const { req, logger } = request({ body })
  const res = response()
  await POST(req, res)
  expect(res.status).toHaveBeenCalledWith(400)
  expect(mockVerifyWebhookRun).not.toHaveBeenCalled()
  expect(logger.warn).toHaveBeenCalledWith("YooKassa webhook rejected: invalid payload")
})

it("passes the exact raw bytes and a deterministic transaction id", async () => {
  const rawBody = Buffer.from("{ exact webhook bytes }")
  const { req } = request({ rawBody, headers: { "content-type": "application/json" } })
  const res = response()
  await POST(req, res)
  const invocation = mockVerifyWebhookRun.mock.calls[0][0]
  expect(invocation.input).toEqual(expect.objectContaining({
    provider: "yookassa_yookassa",
    provider_id: "yookassa",
    provider_payment_id: "payment_1",
    event: "payment.succeeded",
    raw_data_base64: rawBody.toString("base64"),
    headers: { "content-type": "application/json" },
  }))
  expect(invocation.context.transactionId).toMatch(/^catalog-yookassa-webhook-[a-f0-9]{64}$/)
  expect(res.json).toHaveBeenCalledWith({ received: true, session_id: "payses_1" })

  const fallback = request()
  await POST(fallback.req, response())
  expect(mockVerifyWebhookRun.mock.calls[1][0].input.raw_data_base64)
    .toBe(Buffer.from(JSON.stringify(fallback.req.body)).toString("base64"))
  expect(mockVerifyWebhookRun.mock.calls[1][0].context.transactionId)
    .toBe(invocation.context.transactionId)
})

it("dispatches refund.succeeded to the refund reconciliation workflow", async () => {
  const rawBody = Buffer.from("{ refund webhook }")
  const { req } = request({
    rawBody,
    body: { event: "refund.succeeded", object: { id: "refund_1" } },
  })
  const res = response()

  await POST(req, res)

  expect(mockVerifyWebhookRun).not.toHaveBeenCalled()
  expect(mockRefundWebhookRun).toHaveBeenCalledWith({
    input: expect.objectContaining({
      provider: "yookassa_yookassa",
      provider_id: "yookassa",
      refund_id: "refund_1",
      event: "refund.succeeded",
      raw_data_base64: rawBody.toString("base64"),
    }),
    context: {
      transactionId: expect.stringMatching(
        /^catalog-yookassa-webhook-[a-f0-9]{64}$/
      ),
    },
  })
  expect(res.status).toHaveBeenCalledWith(200)
  expect(res.json).toHaveBeenCalledWith({ received: true, refund_id: "refund_1" })
})

it("maps signature/domain rejection to 400, including deserialized Medusa errors", async () => {
  const error = new MedusaError(MedusaError.Types.NOT_ALLOWED, "signature mismatch")
  mockVerifyWebhookRun.mockRejectedValueOnce(error)
  const first = request()
  const firstRes = response()
  await POST(first.req, firstRes)
  expect(firstRes.status).toHaveBeenCalledWith(400)
  expect(first.logger.warn).toHaveBeenCalledWith(expect.stringContaining("verification failed"))

  mockVerifyWebhookRun.mockRejectedValueOnce({
    type: MedusaError.Types.NOT_ALLOWED,
    message: "deserialized",
    __isMedusaError: true,
  })
  const second = request()
  const secondRes = response()
  await POST(second.req, secondRes)
  expect(secondRes.status).toHaveBeenCalledWith(400)
})

it("returns 503 and logs only safe diagnostics for transient failures", async () => {
  for (const failure of [new Error("database unavailable"), { message: "plain object" }]) {
    mockVerifyWebhookRun.mockRejectedValueOnce(failure)
    const { req, logger } = request()
    const res = response()
    await POST(req, res)
    expect(res.status).toHaveBeenCalledWith(503)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(
      failure instanceof Error ? "database unavailable" : "Unknown error"
    ))
  }
})
