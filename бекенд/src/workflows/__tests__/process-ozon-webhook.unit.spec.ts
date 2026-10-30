import { createHmac } from "node:crypto"
import { mapOzonStatus, parseOzonWebhookEvent, processOzonWebhook } from "../process-ozon-webhook"
import { OZON_PROVIDER_KEY } from "../../modules/shipping-provider-registry"

const secret = "secret"
const signature = createHmac("sha256", secret).update("raw").digest("hex")
const event = { event_id: "evt-1", event_type: "shipment.updated", shipment_id: "ship-1", status: "delivered", event_at: "2026-09-30T10:00:00Z" }

function harness(verifyWebhook = jest.fn().mockReturnValue(true)) {
  const service = {
    getProviderConfig: jest.fn().mockResolvedValue({ encrypted_credentials: "encrypted" }),
    verifyOzonWebhookSignature: verifyWebhook,
    listShippingWebhookEvents: jest.fn().mockResolvedValue([]),
    listShippingShipments: jest.fn().mockResolvedValue([{ id: "local-1", simplified_status: "in_transit", status_event_at: null }]),
    updateShippingShipments: jest.fn(), createShippingWebhookEvents: jest.fn(),
  }
  return {
    service,
    container: {
      resolve: jest.fn((key: string) => key === "locking"
          ? { execute: (_k: string, job: () => unknown) => job() }
          : key === "logger"
            ? { info: jest.fn() }
            : service),
    } as any,
  }
}

jest.mock("../../modules/shipping-provider-registry/credentials", () => ({ decryptShippingProviderCredentials: jest.fn(() => ({ client_id: "id", client_secret: secret })) }))

it("maps only known statuses and rejects malformed payloads", () => {
  expect(mapOzonStatus("delivered")).toBe("delivered")
  expect(mapOzonStatus("unknown")).toBeNull()
  expect(() => parseOzonWebhookEvent({ event_id: "x" })).toThrow("Invalid Ozon webhook payload")
})

it("applies a signed known event and stores the idempotency record", async () => {
  const verifyWebhook = jest.fn().mockReturnValue(true)
  const { container, service } = harness(verifyWebhook)
  await expect(processOzonWebhook(container, Buffer.from("raw"), { "x-ozon-signature": signature }, event)).resolves.toEqual({ status: "applied", event_id: "evt-1" })
  expect(verifyWebhook).toHaveBeenCalled()
  expect(service.updateShippingShipments).toHaveBeenCalledWith(expect.objectContaining({ id: "local-1", simplified_status: "delivered" }))
  expect(service.createShippingWebhookEvents).toHaveBeenCalledWith(expect.objectContaining({ provider_key: OZON_PROVIDER_KEY, applied: true }))
})

it("rejects an invalid signature before processing", async () => {
  const { container } = harness(jest.fn().mockReturnValue(false))
  await expect(processOzonWebhook(container, Buffer.from("raw"), { "x-ozon-signature": "bad" }, event)).rejects.toThrow("Invalid Ozon webhook signature")
})

it("returns duplicate for an already processed event", async () => {
  const { container, service } = harness()
  service.listShippingWebhookEvents.mockResolvedValueOnce([{ event_uuid: event.event_id }])

  await expect(processOzonWebhook(container, Buffer.from("raw"), { "x-ozon-signature": signature }, event)).resolves.toEqual({ status: "duplicate", event_id: "evt-1" })
  expect(service.updateShippingShipments).not.toHaveBeenCalled()
  expect(service.createShippingWebhookEvents).not.toHaveBeenCalled()
})
