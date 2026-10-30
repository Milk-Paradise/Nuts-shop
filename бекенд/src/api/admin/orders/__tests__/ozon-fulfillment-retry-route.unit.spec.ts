jest.mock("../../../../workflows/create-ozon-order-fulfillment", () => ({
  createOzonOrderFulfillmentIfNeeded: jest.fn(),
}))

import { POST } from "../[id]/ozon-fulfillment/retry/route"
import { createOzonOrderFulfillmentIfNeeded } from "../../../../workflows/create-ozon-order-fulfillment"

const retry = createOzonOrderFulfillmentIfNeeded as jest.Mock

it("retries the Ozon workflow and maps a failed result to 502", async () => {
  retry.mockResolvedValue({ status: "failed", error: "Ozon unavailable" })
  const res = { status: jest.fn(() => res), json: jest.fn() } as any
  const req = { params: { id: "order_1" }, scope: {} } as any
  await POST(req, res)
  expect(retry).toHaveBeenCalledWith(req.scope, "order_1")
  expect(res.status).toHaveBeenCalledWith(502)
  expect(res.json).toHaveBeenCalledWith({ result: { status: "failed", error: "Ozon unavailable" } })
})

it("returns 200 for a skipped duplicate", async () => {
  retry.mockResolvedValue({ status: "skipped", reason: "already_fulfilled" })
  const res = { status: jest.fn(() => res), json: jest.fn() } as any
  await POST({ params: { id: "order_2" }, scope: {} } as any, res)
  expect(res.status).toHaveBeenCalledWith(200)
})
