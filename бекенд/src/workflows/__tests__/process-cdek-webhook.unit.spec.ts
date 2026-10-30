import { MedusaError } from "@medusajs/framework/utils"

import {
  canApplyCdekStatus,
  cdekWebhookSignature,
  mapCdekStatusToSimplified,
  parseCdekWebhookEvent,
  processCdekWebhook,
  verifyCdekWebhookSignature,
} from "../process-cdek-webhook"
import { encryptShippingProviderCredentials } from "../../modules/shipping-provider-registry/credentials"
import { catalogOrderCancellationResponse } from "../../api/store/account/orders/[id]/cancel/response"
import { prepareCatalogOrderCancellation } from "../steps/prepare-catalog-order-cancellation"
import { createCatalogShippingReturnRequest } from "../steps/create-catalog-shipping-return-request"

const secret = "webhook-secret-must-not-leak"

function event(uuid: string, code = "DELIVERED", statusDate = "2026-08-24T10:00:00+0300") {
  return {
    type: "ORDER_STATUS",
    uuid,
    date_time: statusDate,
    attributes: {
      order_uuid: "shipment-1",
      cdek_number: "1234567890",
      code,
      status_date_time: statusDate,
      is_return: false,
      is_reverse: false,
      is_client_return: false,
    },
  }
}

function harness() {
  const shipment = {
    id: "ship_1",
    order_id: "order_1",
    provider_key: "cdek_cdek",
    provider_shipment_id: "shipment-1",
    simplified_status: "placed",
    status_event_at: null as Date | null,
    label_event_uuid: null as string | null,
    label_request_uuid: "print-uuid",
    label_url: null as string | null,
  }
  const processed: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const encrypted_credentials = encryptShippingProviderCredentials({
    client_id: "client-id",
    client_secret: secret,
  })
  const service = {
    getProviderConfig: jest.fn().mockResolvedValue({ encrypted_credentials }),
    listShippingWebhookEvents: jest.fn(async ({ event_uuid }) =>
      processed.filter((item) => item.event_uuid === event_uuid)),
    createShippingWebhookEvents: jest.fn(async (input) => {
      processed.push(input)
      return input
    }),
    listShippingShipments: jest.fn(async () => [shipment]),
    updateShippingShipments: jest.fn(async (input) => {
      updates.push(input)
      Object.assign(shipment, input)
      return shipment
    }),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "shippingProviderRegistry") return service
      if (key === "locking") return { execute: (_key, callback) => callback() }
      if (key === "logger") return { info: jest.fn() }
      throw new Error(`Unexpected dependency: ${key}`)
    }),
  }
  return { container: container as never, shipment, processed, updates }
}

describe("CDEK webhook processing", () => {
  const previousKey = process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "test-encryption-key"
  })

  afterAll(() => {
    if (previousKey === undefined) delete process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY
    else process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = previousKey
  })

  it("rejects a request with an invalid HMAC before changing shipment state", async () => {
    const { container, updates, processed } = harness()
    const body = event("event-invalid")
    const raw = Buffer.from(JSON.stringify(body))

    await expect(processCdekWebhook(container, raw, "0".repeat(64), body))
      .rejects.toBeInstanceOf(MedusaError)
    expect(updates).toHaveLength(0)
    expect(processed).toHaveLength(0)
  })

  it("processes the same event uuid only once", async () => {
    const { container, updates, processed } = harness()
    const body = event("event-once")
    const raw = Buffer.from(JSON.stringify(body))
    const signature = cdekWebhookSignature(raw, secret)

    await expect(processCdekWebhook(container, raw, signature, body))
      .resolves.toMatchObject({ status: "applied" })
    await expect(processCdekWebhook(container, raw, signature, body))
      .resolves.toMatchObject({ status: "duplicate" })
    expect(updates).toHaveLength(1)
    expect(processed).toHaveLength(1)
  })

  it("does not roll a shipment back when an older event arrives later", async () => {
    const { container, shipment, updates } = harness()
    const newer = event("event-new", "DELIVERED", "2026-08-24T12:00:00+0300")
    const older = event("event-old", "RECEIVED_AT_SHIPMENT_WAREHOUSE", "2026-08-24T11:00:00+0300")
    for (const body of [newer, older]) {
      const raw = Buffer.from(JSON.stringify(body))
      await processCdekWebhook(container, raw, cdekWebhookSignature(raw, secret), body)
    }

    expect(shipment.simplified_status).toBe("delivered")
    expect(updates).toHaveLength(1)
  })

  it("returns only canceled when cancellation wins the order lock", async () => {
    const { container, shipment, updates } = harness()
    const scope = container as unknown as { resolve: jest.Mock }
    const service = scope.resolve("shippingProviderRegistry")
    const originalResolve = scope.resolve
    scope.resolve = jest.fn((key: string) => {
      if (key !== "locking") return originalResolve(key)
      return {
        execute: async (lockKey: string, callback: () => Promise<unknown>) => {
          if (lockKey === "order_1") {
            // Models cancellation winning the shared order lock while the
            // webhook is queued after its identity lookup.
            shipment.simplified_status = "cancelled"
          }
          return callback()
        },
      }
    })
    const body = event(
      "event-race",
      "RECEIVED_AT_SHIPMENT_WAREHOUSE",
      "2026-08-24T10:00:00+0300"
    )
    const raw = Buffer.from(JSON.stringify(body))

    await expect(
      processCdekWebhook(container, raw, cdekWebhookSignature(raw, secret), body)
    ).resolves.toMatchObject({ status: "ignored" })
    expect(shipment.simplified_status).toBe("cancelled")
    expect(updates).toHaveLength(0)
    expect(service.createShippingWebhookEvents).toHaveBeenCalledTimes(1)
    expect(catalogOrderCancellationResponse({ id: "order_1" } as any, "canceled"))
      .toEqual({
        order: { id: "order_1" },
        outcome: "canceled",
        message: "Заказ отменён",
      })
  })

  it("returns only return_requested when the warehouse webhook wins the order lock", async () => {
    const { container, shipment } = harness()
    const scope = container as unknown as { resolve: jest.Mock }
    const service = scope.resolve("shippingProviderRegistry")
    const requests: any[] = []
    service.listShippingReturnRequests = jest.fn(async () => requests)
    service.createShippingReturnRequests = jest.fn(async (input) => {
      const request = { id: "ret_1", ...input }
      requests.push(request)
      return request
    })
    const originalResolve = scope.resolve
    scope.resolve = jest.fn((key: string) => {
      if (key === "query") {
        return {
          graph: jest.fn().mockResolvedValue({
            data: [{
              id: "order_1",
              status: "pending",
              email: "buyer@test.com",
              customer: { id: "cus_1" },
              items: [],
              fulfillments: [{ id: "ful_1", provider_id: "cdek_cdek", canceled_at: null }],
              payment_collections: [],
            }],
          }),
        }
      }
      return originalResolve(key)
    })
    const body = event(
      "event-race-return",
      "RECEIVED_AT_SHIPMENT_WAREHOUSE",
      "2026-08-24T10:00:00+0300"
    )
    const raw = Buffer.from(JSON.stringify(body))

    await processCdekWebhook(container, raw, cdekWebhookSignature(raw, secret), body)
    const preparation = await prepareCatalogOrderCancellation(container as any, {
      order_id: "order_1",
      customer_id: "cus_1",
      customer_email: "buyer@test.com",
    })
    const result = await createCatalogShippingReturnRequest(container as any, {
      order_id: "order_1",
      previous_delivery_status: preparation.previous_delivery_status!,
    })

    expect(preparation.requires_return_request).toBe(true)
    expect(result.request.id).toBe("ret_1")
    expect(catalogOrderCancellationResponse({ id: "order_1" } as any, "return_requested"))
      .toEqual({
        order: { id: "order_1" },
        outcome: "return_requested",
        message: "Заявка на возврат отправлена",
      })
  })

  it("maps documented return flags into the shared sixth status", () => {
    expect(mapCdekStatusToSimplified("CREATED", { is_return: true }))
      .toBe("return_in_progress")
    expect(mapCdekStatusToSimplified("TAKEN_BY_COURIER", {})).toBe("in_transit")
  })

  it.each([
    ["INVALID", "cancelled"],
    ["POSTOMAT_RECEIVED", "delivered"],
    ["ACCEPTED", "placed"],
    ["ACCEPTED_IN_SENDER_CITY", "preparing"],
    ["ARRIVED_AT_RECIPIENT_CITY", "in_transit"],
    ["FUTURE_UNKNOWN_CODE", null],
  ])("maps CDEK code %s without inventing progress", (code, expected) => {
    expect(mapCdekStatusToSimplified(code, {})).toBe(expected)
  })

  it("gives every documented return flag precedence over ordinary progress", () => {
    expect(mapCdekStatusToSimplified("DELIVERED", { is_reverse: true })).toBe("return_in_progress")
    expect(mapCdekStatusToSimplified("DELIVERED", { is_client_return: true })).toBe("return_in_progress")
    expect(mapCdekStatusToSimplified("NOT_DELIVERED", {})).toBe("return_in_progress")
  })

  it("rejects malformed signatures and accepts the exact body HMAC", () => {
    const raw = Buffer.from("payload")
    const signature = cdekWebhookSignature(raw, secret)
    expect(verifyCdekWebhookSignature(raw, "short", secret)).toBe(false)
    expect(verifyCdekWebhookSignature(raw, "g".repeat(64), secret)).toBe(false)
    expect(verifyCdekWebhookSignature(raw, signature, secret)).toBe(true)
    expect(verifyCdekWebhookSignature(Buffer.from("changed"), signature, secret)).toBe(false)
  })

  it.each([
    null,
    [],
    {},
    { type: "OTHER", uuid: "x", date_time: "2026-01-01", attributes: {} },
    { type: "ORDER_STATUS", uuid: 1, date_time: "2026-01-01", attributes: {} },
    { type: "ORDER_STATUS", uuid: "", date_time: "2026-01-01", attributes: {} },
    { type: "ORDER_STATUS", uuid: "x", date_time: 1, attributes: {} },
    { type: "ORDER_STATUS", uuid: "x", date_time: "invalid", attributes: {} },
    { type: "ORDER_STATUS", uuid: "x", date_time: "2026-01-01", attributes: null },
    { type: "ORDER_STATUS", uuid: "x", date_time: "2026-01-01", attributes: [] },
  ])("rejects malformed webhook event %#", (value) => {
    expect(() => parseCdekWebhookEvent(value)).toThrow(MedusaError)
  })

  it("accepts both supported event shapes", () => {
    expect(parseCdekWebhookEvent(event("valid"))).toMatchObject({ type: "ORDER_STATUS" })
    expect(parseCdekWebhookEvent({
      type: "PRINT_FORM", uuid: "print", date_time: "2026-08-24T13:00:00Z", attributes: {},
    })).toMatchObject({ type: "PRINT_FORM" })
  })

  it("enforces event ordering, terminal states, and monotonic progress", () => {
    const at = new Date("2026-08-24T12:00:00Z")
    expect(canApplyCdekStatus("placed", null, "preparing", at)).toBe(true)
    expect(canApplyCdekStatus("delivered", null, "preparing", at)).toBe(false)
    expect(canApplyCdekStatus("placed", null, "cancelled", at)).toBe(true)
    expect(canApplyCdekStatus("placed", null, "return_in_progress", at)).toBe(true)
    expect(canApplyCdekStatus("cancelled", null, "delivered", at)).toBe(false)
    expect(canApplyCdekStatus("return_in_progress", null, "delivered", at)).toBe(false)
    expect(canApplyCdekStatus("placed", "2026-08-24T12:00:00Z", "delivered", at)).toBe(false)
    expect(canApplyCdekStatus("placed", "2026-08-24T13:00:00Z", "delivered", at)).toBe(false)
  })

  it("rejects signed events when credentials or the supplied signature are missing", async () => {
    for (const missing of ["credentials", "signature"] as const) {
      const { container } = harness()
      const service = (container as any).resolve("shippingProviderRegistry")
      if (missing === "credentials") service.getProviderConfig.mockResolvedValue(null)
      const body = event(`event-${missing}`)
      const raw = Buffer.from(JSON.stringify(body))
      await expect(processCdekWebhook(
        container, raw, missing === "signature" ? undefined : cdekWebhookSignature(raw, secret), body,
      )).rejects.toBeInstanceOf(MedusaError)
    }
  })

  it("records a valid but unmatched event as ignored", async () => {
    const { container } = harness()
    const service = (container as any).resolve("shippingProviderRegistry")
    service.listShippingShipments.mockResolvedValue([])
    service.listShippingReturnRequests = jest.fn().mockResolvedValue([])
    const body = event("unmatched")
    const raw = Buffer.from(JSON.stringify(body))
    await expect(processCdekWebhook(container, raw, cdekWebhookSignature(raw, secret), body))
      .resolves.toEqual({ status: "ignored", event_uuid: "unmatched" })
    expect(service.createShippingWebhookEvents).toHaveBeenCalledWith(expect.objectContaining({
      shipment_id: null, applied: false,
    }))
  })

  it("updates an independently tracked reverse shipment", async () => {
    const { container } = harness()
    const service = (container as any).resolve("shippingProviderRegistry")
    const returnRequest: any = {
      id: "return_1", order_id: "order_1", return_delivery_status: null,
      return_status_event_at: null,
    }
    service.listShippingShipments.mockResolvedValue([])
    service.listShippingReturnRequests = jest.fn().mockResolvedValue([returnRequest])
    service.updateShippingReturnRequests = jest.fn(async (input) => Object.assign(returnRequest, input))
    const body = event("return-event", "TAKEN_BY_COURIER")
    body.attributes.order_uuid = "return-shipment"
    const raw = Buffer.from(JSON.stringify(body))
    await expect(processCdekWebhook(container, raw, cdekWebhookSignature(raw, secret), body))
      .resolves.toMatchObject({ status: "applied" })
    expect(returnRequest).toMatchObject({
      return_delivery_status: "in_transit", return_tracking_number: "1234567890",
    })
  })

  it("ignores malformed status fields and repeated print-form state", async () => {
    const { container, shipment } = harness()
    const service = (container as any).resolve("shippingProviderRegistry")
    const malformed = event("malformed-status") as any
    malformed.attributes.code = 42
    malformed.attributes.status_date_time = 42
    let raw = Buffer.from(JSON.stringify(malformed))
    await expect(processCdekWebhook(container, raw, cdekWebhookSignature(raw, secret), malformed))
      .resolves.toMatchObject({ status: "ignored" })

    shipment.label_event_uuid = "same-print"
    const print = {
      type: "PRINT_FORM", uuid: "same-print", date_time: "2026-08-24T13:00:00Z",
      attributes: { url: "https://api.cdek.ru/v2/print/orders/print-uuid?download=1" },
    }
    raw = Buffer.from(JSON.stringify(print))
    await expect(processCdekWebhook(container, raw, cdekWebhookSignature(raw, secret), print))
      .resolves.toMatchObject({ status: "ignored" })

    const noUrl = { ...print, uuid: "no-url", attributes: {} }
    raw = Buffer.from(JSON.stringify(noUrl))
    await expect(processCdekWebhook(container, raw, cdekWebhookSignature(raw, secret), noUrl))
      .resolves.toMatchObject({ status: "ignored" })
  })

  it("marks a matching print form as ready and deduplicates its event uuid", async () => {
    const { container, shipment, updates, processed } = harness()
    const body = {
      type: "PRINT_FORM",
      uuid: "print-event",
      date_time: "2026-08-24T13:00:00+0300",
      attributes: {
        type: "BARCODE",
        url: "https://api.cdek.ru/v2/print/barcodes/print-uuid.pdf",
      },
    }
    const raw = Buffer.from(JSON.stringify(body))
    const signature = cdekWebhookSignature(raw, secret)

    await processCdekWebhook(container, raw, signature, body)
    await expect(processCdekWebhook(container, raw, signature, body))
      .resolves.toMatchObject({ status: "duplicate" })
    expect(shipment.label_url).toBe(body.attributes.url)
    expect(updates).toHaveLength(1)
    expect(processed).toHaveLength(1)
  })
})
