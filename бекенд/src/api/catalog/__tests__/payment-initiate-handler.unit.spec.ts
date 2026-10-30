const mockInitiateRun = jest.fn()

jest.mock("../../../workflows/initiate-catalog-online-payment", () => ({
  initiateCatalogOnlinePaymentWorkflow: () => ({ run: mockInitiateRun }),
}))

import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { initiateCatalogPayment as POST } from "../handlers"

function response() {
  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  }
  return res
}

function request(overrides: Record<string, unknown> = {}) {
  const logger = { error: jest.fn() }
  const locking = { execute: jest.fn(async (_keys, callback) => callback()) }
  const scope = {
    resolve: jest.fn((key) => {
      if (key === Modules.LOCKING) return locking
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      throw new Error(`Unexpected dependency: ${String(key)}`)
    }),
  }
  return {
    req: {
      scope,
      validatedBody: {
        order_id: "order_1",
        provider_id: "yookassa",
        return_url: "https://shop.test/payment/result",
      },
      ...overrides,
    } as any,
    logger,
    locking,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.STORE_CORS = " https://shop.test, https://other.test "
  mockInitiateRun.mockResolvedValue({ result: { payment_session_id: "payses_1" } })
})

it("rejects a return URL outside configured storefront origins", async () => {
  const { req, locking } = request()
  req.validatedBody.return_url = "https://attacker.test/result"
  await expect(POST(req, response())).rejects.toBeInstanceOf(MedusaError)
  expect(locking.execute).not.toHaveBeenCalled()
})

it("returns the workflow result, including a reusable payment", async () => {
  const existing = {
    status: "active",
    payment_session_id: "payses_existing",
    redirect_url: "https://pay.test",
  }
  mockInitiateRun.mockResolvedValueOnce({ result: existing })
  const { req } = request()
  const res = response()

  await POST(req, res)

  expect(res.json).toHaveBeenCalledWith({ payment: existing })
})

it("returns the explicit already-paid result without reshaping it", async () => {
  mockInitiateRun.mockResolvedValueOnce({ result: { status: "already_paid" } })
  const { req } = request()
  const res = response()

  await POST(req, res)

  expect(res.json).toHaveBeenCalledWith({ payment: { status: "already_paid" } })
})

it("starts the single payment workflow under the order and provider lock", async () => {
  const { req, locking } = request({ auth_context: { actor_id: "cus_1" } })
  const res = response()
  await POST(req, res)

  expect(locking.execute).toHaveBeenCalledWith(
    "catalog-payment-init:order_1:yookassa",
    expect.any(Function),
    { timeout: 120 }
  )
  expect(mockInitiateRun).toHaveBeenCalledWith({
    input: expect.objectContaining({ order_id: "order_1", customer_id: "cus_1" }),
  })

  const guest = request()
  await POST(guest.req, response())
  expect(mockInitiateRun).toHaveBeenLastCalledWith({
    input: expect.objectContaining({ customer_id: null }),
  })
})

it("preserves domain errors and hides/logs unexpected provider details", async () => {
  const domainError = new MedusaError(MedusaError.Types.INVALID_DATA, "bad order")
  mockInitiateRun.mockRejectedValueOnce(domainError)
  const domain = request()
  await expect(POST(domain.req, response())).rejects.toBe(domainError)

  for (const failure of [
    new Error("provider secret failure"),
    "string failure",
    { detail: new Error("nested failure") },
    { cause: "plain cause" },
    null,
  ]) {
    mockInitiateRun.mockRejectedValueOnce(failure)
    const { req, logger } = request()
    await expect(POST(req, response())).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
      message: expect.not.stringContaining("secret"),
    })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/^Online payment initiation failed: .+/)
    )
  }
})
