import { createHmac } from "node:crypto"

import {
  OzonApiError,
  OzonClient,
  type OzonCreateReturnInput,
  type OzonCreateShipmentInput,
  type OzonTariffCalculationInput,
} from "../ozon-client"

const credentials = {
  client_id: "ozon-client-id-must-not-leak",
  client_secret: "ozon-api-key-must-not-leak",
}

const tariffInput: OzonTariffCalculationInput = {
  from: { city: "Москва" },
  to: { city: "Тула" },
  packages: [{ weight_grams: 1_200, length_mm: 300, width_mm: 200, height_mm: 150 }],
}

const shipmentInput: OzonCreateShipmentInput = {
  external_number: "order_1",
  delivery_point_id: "point_1",
}

const returnInput: OzonCreateReturnInput = {
  shipment_id: "shipment_1",
  reason: "customer_return",
}

const response = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })

const client = (fetcher: jest.Mock, maxRetries = 0) =>
  new OzonClient("https://ozon.test", fetcher, {
    maxRetries,
    retryDelayMs: 0,
    deadlineMs: 1_000,
    requestTimeoutMs: 100,
  })

describe("OzonClient base URL", () => {
  const originalBaseUrl = process.env.OZON_API_BASE_URL

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.OZON_API_BASE_URL
    else process.env.OZON_API_BASE_URL = originalBaseUrl
  })

  it("rejects an implicit endpoint but allows the production host", () => {
    delete process.env.OZON_API_BASE_URL
    expect(() => new OzonClient()).toThrow("OZON_API_BASE_URL must be configured explicitly")
    expect(() => new OzonClient("https://api-seller.ozon.ru")).not.toThrow()
  })
})

describe("OzonClient successful semantic operations", () => {
  it("tests authorization and keeps credentials in request headers only", async () => {
    const fetcher = jest.fn().mockResolvedValue(response({ result: { company_name: "Catalog" } }))

    await expect(client(fetcher).testAuthorization(credentials)).resolves.toBe(true)

    expect(fetcher).toHaveBeenCalledWith(
      "https://ozon.test/v1/seller/info",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Client-Id": credentials.client_id,
          "Api-Key": credentials.client_secret,
        }),
        signal: expect.any(AbortSignal),
      })
    )
  })

  it("normalizes Ozon tariffs and drops malformed entries", async () => {
    const fetcher = jest.fn().mockResolvedValue(response({
      result: {
        tariffs: [
          {
            tariff_id: 42,
            tariff_name: "Ozon ПВЗ",
            price: { amount: 349.5, currency: "RUB" },
            period_min: 2,
            period_max: 4,
            delivery_type: "pickup",
          },
          { tariff_name: "missing id and price" },
        ],
      },
    }))

    await expect(client(fetcher).calculateTariffs(credentials, tariffInput)).resolves.toEqual([
      {
        code: "42",
        name: "Ozon ПВЗ",
        price: 349.5,
        currency: "RUB",
        delivery_days_min: 2,
        delivery_days_max: 4,
        delivery_type: "pickup",
      },
    ])
  })

  it("lists normalized pickup points with a cursor", async () => {
    const fetcher = jest.fn().mockResolvedValue(response({
      result: {
        points: [{
          map_point_id: 123,
          name: "ПВЗ на Тверской",
          address: { full_address: "Москва, Тверская, 1", city: "Москва" },
          location: { lat: 55.76, lon: 37.61 },
          schedule: "09:00-21:00",
        }],
      },
    }))

    await expect(client(fetcher).listPickupPoints(credentials, "next-page")).resolves.toEqual([
      {
        id: "123",
        name: "ПВЗ на Тверской",
        address: "Москва, Тверская, 1",
        city: "Москва",
        latitude: 55.76,
        longitude: 37.61,
        working_hours: "09:00-21:00",
      },
    ])
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ cursor: "next-page" })
  })

  it("creates, finds, gets, and cancels a shipment", async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(response({ result: {
        shipment_id: "shipment_1",
        external_number: "order_1",
        tracking_number: "TRACK-1",
        status: "created",
      } }))
      .mockResolvedValueOnce(response({ result: { orders: [{
        id: "shipment_1",
        external_id: "order_1",
        track_number: "TRACK-1",
        state: "created",
      }] } }))
      .mockResolvedValueOnce(response({ shipment: {
        id: "shipment_1",
        external_number: "order_1",
        tracking_number: "TRACK-1",
        status: "created",
      } }))
      .mockResolvedValueOnce(response({ result: { cancelled: true } }))
    const ozon = client(fetcher)

    const expected = {
      id: "shipment_1",
      external_number: "order_1",
      tracking_number: "TRACK-1",
      status: "created",
    }
    await expect(ozon.createShipment(credentials, shipmentInput, "shipment-key")).resolves.toEqual(expected)
    await expect(ozon.findShipmentByExternalNumber(credentials, "order_1")).resolves.toEqual(expected)
    await expect(ozon.getShipment(credentials, "shipment_1")).resolves.toEqual(expected)
    await expect(ozon.cancelShipment(credentials, "shipment_1")).resolves.toBe(true)
    expect(fetcher.mock.calls[0][1].headers).toEqual(expect.objectContaining({
      "Idempotency-Key": "shipment-key",
    }))
  })

  it("returns null when a shipment cannot be found", async () => {
    const fetcher = jest.fn().mockResolvedValue(response({ code: "NOT_FOUND" }, 404))

    await expect(
      client(fetcher).findShipmentByExternalNumber(credentials, "missing")
    ).resolves.toBeNull()
  })

  it("creates a return with an idempotency key", async () => {
    const fetcher = jest.fn().mockResolvedValue(response({ result: {
      return_id: "return_1",
      shipment_id: "shipment_1",
      status: "created",
    } }))

    await expect(
      client(fetcher).createReturn(credentials, returnInput, "return-key")
    ).resolves.toEqual({ id: "return_1", shipment_id: "shipment_1", status: "created" })
    expect(fetcher.mock.calls[0][1].headers).toEqual(expect.objectContaining({
      "Idempotency-Key": "return-key",
    }))
  })

  it("downloads a PDF label", async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response(Buffer.from("%PDF-mocked"), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=ozon-label.pdf",
      },
    }))

    await expect(client(fetcher).requestLabel(credentials, "shipment_1")).resolves.toEqual({
      content: Buffer.from("%PDF-mocked"),
      content_type: "application/pdf",
      filename: "ozon-label.pdf",
    })
  })

  it("keeps a malformed encoded label filename from escaping as a URIError", async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response(Buffer.from("%PDF-mocked"), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename*=UTF-8''%E0%A4%A",
      },
    }))

    await expect(client(fetcher).requestLabel(credentials, "shipment_1"))
      .resolves.toMatchObject({ filename: "%E0%A4%A" })
  })

  it("verifies a valid webhook signature and rejects tampering", () => {
    const body = Buffer.from(JSON.stringify({ shipment_id: "shipment_1" }))
    const secret = "webhook-secret"
    const signature = createHmac("sha256", secret).update(body).digest("hex")
    const ozon = client(jest.fn())

    expect(ozon.verifyWebhook(body, { "X-Ozon-Signature": `sha256=${signature}` }, secret))
      .toBe(true)
    expect(ozon.verifyWebhook(Buffer.from("tampered"), { "x-ozon-signature": signature }, secret))
      .toBe(false)
    expect(ozon.verifyWebhook(body, {}, secret)).toBe(false)
  })
})

describe("OzonClient errors, retries, and idempotency", () => {
  it.each([
    [401, "AUTH_FAILED", false],
    [429, "RATE_LIMITED", true],
    [500, "INTERNAL", true],
  ])("normalizes an HTTP %i response", async (status, code, retryable) => {
    const fetcher = jest.fn().mockResolvedValue(response({ error: { code } }, status))

    const promise = client(fetcher).testAuthorization(credentials)
    await expect(promise).rejects.toBeInstanceOf(OzonApiError)
    await expect(promise).rejects.toMatchObject({
      status,
      code,
      retryable,
      mayHaveSucceeded: false,
    })
    await expect(promise).rejects.not.toThrow(credentials.client_id)
    await expect(promise).rejects.not.toThrow(credentials.client_secret)
  })

  it("retries safe GET requests on 429 and 500 within the retry limit", async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(response({ code: "RATE_LIMITED" }, 429))
      .mockResolvedValueOnce(response({ code: "INTERNAL" }, 500))
      .mockResolvedValueOnce(response({ result: { id: "shipment_1" } }))

    await expect(client(fetcher, 2).getShipment(credentials, "shipment_1")).resolves.toEqual({
      id: "shipment_1",
      external_number: null,
      tracking_number: null,
      status: null,
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("retries idempotent POST requests with the same key", async () => {
    const fetcher = jest.fn()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(response({ result: { shipment_id: "shipment_1" } }))

    await expect(
      client(fetcher, 1).createShipment(credentials, shipmentInput, "stable-key")
    ).resolves.toMatchObject({ id: "shipment_1" })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.map((call) => call[1].headers["Idempotency-Key"]))
      .toEqual(["stable-key", "stable-key"])
  })

  it("does not retry a non-idempotent POST", async () => {
    const fetcher = jest.fn().mockResolvedValue(response({ code: "INTERNAL" }, 500))

    await expect(client(fetcher, 2).calculateTariffs(credentials, tariffInput))
      .rejects.toMatchObject({ status: 500, retryable: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("returns the same cached result for duplicate shipment and return keys", async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(response({ result: { shipment_id: "shipment_1" } }))
      .mockResolvedValueOnce(response({ result: { return_id: "return_1" } }))
    const ozon = client(fetcher)

    const firstShipment = await ozon.createShipment(credentials, shipmentInput, "shipment-key")
    const secondShipment = await ozon.createShipment(credentials, { external_number: "changed" }, "shipment-key")
    const firstReturn = await ozon.createReturn(credentials, returnInput, "return-key")
    const secondReturn = await ozon.createReturn(credentials, { shipment_id: "changed" }, "return-key")

    expect(secondShipment).toBe(firstShipment)
    expect(secondReturn).toBe(firstReturn)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("marks an exhausted idempotent POST network failure as possibly succeeded", async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error("offline"))

    await expect(
      client(fetcher, 1).createReturn(credentials, returnInput, "return-key")
    ).rejects.toMatchObject({
      status: 502,
      code: "NETWORK_ERROR",
      retryable: true,
      mayHaveSucceeded: true,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("enforces the timeout of each individual request", async () => {
    const fetcher = jest.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal
        const rejectWithReason = () => reject(signal.reason)
        if (signal.aborted) rejectWithReason()
        else signal.addEventListener("abort", rejectWithReason, { once: true })
      }))
    const ozon = new OzonClient("https://ozon.test", fetcher, {
      deadlineMs: 100,
      requestTimeoutMs: 5,
      maxRetries: 0,
      retryDelayMs: 0,
    })

    await expect(ozon.getShipment(credentials, "shipment_1")).rejects.toMatchObject({
      status: 502,
      code: "TIMEOUT",
      retryable: true,
      mayHaveSucceeded: false,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("stops retries when their shared deadline is exhausted", async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error("offline"))
    const ozon = new OzonClient("https://ozon.test", fetcher, {
      deadlineMs: 5,
      requestTimeoutMs: 100,
      maxRetries: 5,
      retryDelayMs: 20,
    })

    await expect(ozon.getShipment(credentials, "shipment_1")).rejects.toMatchObject({
      status: 502,
      code: "NETWORK_ERROR",
      retryable: true,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("normalizes label body read failures", async () => {
    const labelResponse = new Response(Buffer.from("%PDF-mocked"), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    })
    jest.spyOn(labelResponse, "arrayBuffer")
      .mockRejectedValue(new DOMException("timed out", "TimeoutError"))
    const fetcher = jest.fn().mockResolvedValue(labelResponse)

    await expect(client(fetcher).requestLabel(credentials, "shipment_1"))
      .rejects.toMatchObject({
        status: 502,
        code: "TIMEOUT",
        retryable: true,
        mayHaveSucceeded: false,
      })
  })

  it("rejects an empty idempotency key before making a request", async () => {
    const fetcher = jest.fn()

    await expect(client(fetcher).createShipment(credentials, shipmentInput, " "))
      .rejects.toMatchObject({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
