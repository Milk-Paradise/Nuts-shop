jest.mock("../../../../workflows/process-ozon-webhook", () => ({
  processOzonWebhook: jest.fn(),
}))

import { POST } from "../ozon/route"
import { processOzonWebhook } from "../../../../workflows/process-ozon-webhook"

const processWebhook = processOzonWebhook as jest.Mock

it("passes raw body and headers to the Ozon webhook processor", async () => {
  processWebhook.mockResolvedValue({ status: "applied", event_id: "evt-1" })
  const res = { status: jest.fn(() => res), json: jest.fn() } as any
  const req = {
    rawBody: Buffer.from("signed-body"),
    body: { event_id: "evt-1" },
    headers: { "x-ozon-signature": "signature" },
    scope: { resolve: jest.fn() },
  } as any
  await POST(req, res)
  expect(processWebhook).toHaveBeenCalledWith(req.scope, req.rawBody, req.headers, req.body)
  expect(res.status).toHaveBeenCalledWith(200)
  expect(res.json).toHaveBeenCalledWith({ result: { status: "applied", event_id: "evt-1" } })
})
