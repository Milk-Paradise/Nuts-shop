import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import {
  type ShippingProviderCredentials,
} from "./credentials"

export type OzonTariffCalculationInput = Record<string, unknown>
export type OzonCreateShipmentInput = Record<string, unknown>
export type OzonCreateReturnInput = Record<string, unknown>

export type Tariff = {
  code: string
  name: string
  price: number
  currency: string
  delivery_days_min: number | null
  delivery_days_max: number | null
  delivery_type: string | null
}

export type PickupPoint = {
  id: string
  name: string
  address: string
  city: string | null
  latitude: number | null
  longitude: number | null
  working_hours: string | null
}

export type Shipment = {
  id: string
  external_number: string | null
  tracking_number: string | null
  status: string | null
}

export type Return = {
  id: string
  shipment_id: string | null
  status: string | null
}

export type Label = {
  content: Buffer
  content_type: string
  filename: string | null
}

export type OzonClientOptions = {
  deadlineMs?: number
  requestTimeoutMs?: number
  maxRetries?: number
  retryDelayMs?: number
}

type RequestOptions = {
  idempotencyKey?: string
  mayHaveSucceeded?: boolean
}

const DEFAULT_DEADLINE_MS = 8_000
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 100
const MAX_IDEMPOTENCY_ENTRIES = 1_000

export class OzonApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly mayHaveSucceeded: boolean
  ) {
    super(message)
    this.name = "OzonApiError"
  }
}

/**
 * Semantic adapter for Ozon Delivery. Provider-specific payloads stop here;
 * callers receive the small normalized domain shapes exported above.
 */
export class OzonClient {
  private readonly baseUrl: string
  private readonly deadlineMs: number
  private readonly requestTimeoutMs: number
  private readonly maxRetries: number
  private readonly retryDelayMs: number
  private readonly idempotentResults = new Map<string, Promise<Shipment | Return>>()

  constructor(
    baseUrl = resolveBaseUrl(),
    private readonly fetcher: typeof fetch = fetch,
    options: OzonClientOptions = {}
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.deadlineMs = positiveInteger(options.deadlineMs, DEFAULT_DEADLINE_MS)
    this.requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS
    )
    this.maxRetries = nonNegativeInteger(options.maxRetries, DEFAULT_MAX_RETRIES)
    this.retryDelayMs = nonNegativeInteger(
      options.retryDelayMs,
      DEFAULT_RETRY_DELAY_MS
    )
  }

  async testAuthorization(credentials: ShippingProviderCredentials): Promise<boolean> {
    await this.requestJson(credentials, "/v1/seller/info", { method: "POST" })
    return true
  }

  async calculateTariffs(
    credentials: ShippingProviderCredentials,
    input: OzonTariffCalculationInput
  ): Promise<Tariff[]> {
    const payload = await this.requestJson(
      credentials,
      "/v1/logistic/tariff/calculate",
      jsonPost(input)
    )
    const tariffs = extractCollection(payload, ["tariffs", "items", "result"])
      .flatMap(normalizeTariff)

    if (!tariffs.length) {
      throw invalidResponse("Ozon returned no valid tariffs.")
    }
    return tariffs
  }

  async listPickupPoints(
    credentials: ShippingProviderCredentials,
    cursor?: string
  ): Promise<PickupPoint[]> {
    const payload = await this.requestJson(
      credentials,
      "/v1/logistic/point/list",
      jsonPost(cursor ? { cursor } : {})
    )
    return extractCollection(payload, ["points", "items", "result"])
      .flatMap(normalizePickupPoint)
  }

  async createShipment(
    credentials: ShippingProviderCredentials,
    input: OzonCreateShipmentInput,
    idempotencyKey: string
  ): Promise<Shipment> {
    requireIdempotencyKey(idempotencyKey)
    return this.oncePerKey(
      `shipment:${credentialOwner(credentials)}:${idempotencyKey}`,
      async () => {
        const payload = await this.requestJson(
          credentials,
          "/v1/logistic/order/create",
          jsonPost(input),
          { idempotencyKey, mayHaveSucceeded: true }
        )
        return requireShipment(payload, true)
      }
    ) as Promise<Shipment>
  }

  async findShipmentByExternalNumber(
    credentials: ShippingProviderCredentials,
    orderId: string
  ): Promise<Shipment | null> {
    try {
      const payload = await this.requestJson(
        credentials,
        `/v1/logistic/order/list?external_number=${encodeURIComponent(orderId)}`,
        { method: "GET" }
      )
      const item = extractCollection(payload, ["orders", "items", "result"])[0]
      return item ? normalizeShipment(item) : null
    } catch (error) {
      if (error instanceof OzonApiError && error.status === 404) return null
      throw error
    }
  }

  async getShipment(
    credentials: ShippingProviderCredentials,
    shipmentId: string
  ): Promise<Shipment> {
    const payload = await this.requestJson(
      credentials,
      `/v1/logistic/order/info?id=${encodeURIComponent(shipmentId)}`,
      { method: "GET" }
    )
    return requireShipment(payload, false)
  }

  async cancelShipment(
    credentials: ShippingProviderCredentials,
    shipmentId: string
  ): Promise<boolean> {
    const payload = await this.requestJson(
      credentials,
      "/v1/logistic/order/cancel",
      jsonPost({ id: shipmentId })
    )
    const value = unwrapRecord(payload)
    return typeof value.cancelled === "boolean"
      ? value.cancelled
      : typeof value.success === "boolean"
        ? value.success
        : true
  }

  async createReturn(
    credentials: ShippingProviderCredentials,
    input: OzonCreateReturnInput,
    idempotencyKey: string
  ): Promise<Return> {
    requireIdempotencyKey(idempotencyKey)
    return this.oncePerKey(
      `return:${credentialOwner(credentials)}:${idempotencyKey}`,
      async () => {
        const payload = await this.requestJson(
          credentials,
          "/v1/logistic/return/create",
          jsonPost(input),
          { idempotencyKey, mayHaveSucceeded: true }
        )
        return requireReturn(payload)
      }
    ) as Promise<Return>
  }

  async requestLabel(
    credentials: ShippingProviderCredentials,
    shipmentId: string
  ): Promise<Label> {
    const response = await this.request(
      credentials,
      `/v1/logistic/order/label?id=${encodeURIComponent(shipmentId)}`,
      { method: "GET", headers: { accept: "application/pdf" } }
    )
    const contentType = response.headers.get("content-type") ?? "application/pdf"
    const contentDisposition = response.headers.get("content-disposition")

    if (contentType.includes("application/json")) {
      const payload = await readJson(response, false)
      const value = unwrapRecord(payload)
      const encoded = firstString(value, ["content", "file", "data"])
      if (!encoded) throw invalidResponse("Ozon returned an invalid label.")
      return {
        content: Buffer.from(encoded, "base64"),
        content_type: "application/pdf",
        filename: firstString(value, ["filename", "file_name", "name"]),
      }
    }

    return {
      content: await readLabelContent(response),
      content_type: contentType,
      filename: filenameFromDisposition(contentDisposition),
    }
  }

  verifyWebhook(
    rawBody: string | Buffer,
    headers: Headers | Record<string, string | string[] | undefined>,
    secret: string
  ): boolean {
    if (!secret) return false
    const supplied = webhookSignature(headers)
    if (!supplied) return false
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
    const normalized = supplied.replace(/^sha256=/i, "").trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(normalized)) return false
    return timingSafeEqual(Buffer.from(normalized, "hex"), Buffer.from(expected, "hex"))
  }

  private async requestJson(
    credentials: ShippingProviderCredentials,
    path: string,
    init: RequestInit,
    options: RequestOptions = {}
  ): Promise<unknown> {
    const response = await this.request(credentials, path, init, options)
    return readJson(response, options.mayHaveSucceeded ?? false)
  }

  private async request(
    credentials: ShippingProviderCredentials,
    path: string,
    init: RequestInit,
    options: RequestOptions = {}
  ): Promise<Response> {
    const deadline = Date.now() + this.deadlineMs
    const method = (init.method ?? "GET").toUpperCase()
    const canRetry = method === "GET" || method === "HEAD" ||
      (method === "POST" && !!options.idempotencyKey)
    let lastError: OzonApiError | undefined

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (Date.now() >= deadline) break
      try {
        const response = await this.fetcher(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            "Client-Id": credentials.client_id,
            "Api-Key": credentials.client_secret,
            ...init.headers,
            ...(options.idempotencyKey
              ? { "Idempotency-Key": options.idempotencyKey }
              : {}),
          },
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(this.requestTimeoutMs, deadline - Date.now()))
          ),
        })

        if (response.ok) return response
        lastError = await errorFromResponse(response, options.mayHaveSucceeded ?? false)
      } catch (error) {
        if (error instanceof OzonApiError) throw error
        lastError = new OzonApiError(
          "Ozon request failed before a response was received.",
          502,
          isAbortError(error) ? "TIMEOUT" : "NETWORK_ERROR",
          true,
          options.mayHaveSucceeded ?? false
        )
      }

      if (!canRetry || !lastError.retryable || attempt >= this.maxRetries) {
        throw lastError
      }
      const pause = Math.min(this.retryDelayMs * (attempt + 1), deadline - Date.now())
      if (pause > 0) await delay(pause)
    }

    throw lastError ?? new OzonApiError(
      "Ozon request exceeded its deadline.",
      504,
      "DEADLINE_EXCEEDED",
      true,
      options.mayHaveSucceeded ?? false
    )
  }

  private oncePerKey<T extends Shipment | Return>(
    key: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const existing = this.idempotentResults.get(key)
    if (existing) return existing as Promise<T>

    const result = operation().catch((error) => {
      this.idempotentResults.delete(key)
      throw error
    })
    this.idempotentResults.set(key, result)
    if (this.idempotentResults.size > MAX_IDEMPOTENCY_ENTRIES) {
      const oldest = this.idempotentResults.keys().next().value as string | undefined
      if (oldest && oldest !== key) this.idempotentResults.delete(oldest)
    }
    return result
  }
}

function credentialOwner(credentials: ShippingProviderCredentials) {
  return createHash("sha256")
    .update(credentials.client_id)
    .digest("base64url")
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  }
}

async function errorFromResponse(
  response: Response,
  mayHaveSucceeded: boolean
): Promise<OzonApiError> {
  let payload: unknown
  try {
    payload = await response.clone().json()
  } catch {
    payload = undefined
  }
  const value = isRecord(payload) ? payload : {}
  const nested = isRecord(value.error) ? value.error : value
  const code = safeErrorCode(
    firstString(nested, ["code", "error_code", "type"]),
    response.status
  )
  const retryable = response.status === 408 || response.status === 425 ||
    response.status === 429 || response.status >= 500
  return new OzonApiError(
    response.status === 401 || response.status === 403
      ? "Ozon rejected the configured credentials."
      : `Ozon API request failed (${code}).`,
    response.status,
    code,
    retryable,
    mayHaveSucceeded && retryable
  )
}

async function readJson(response: Response, mayHaveSucceeded: boolean): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new OzonApiError(
      "Ozon returned a response in an unknown format.",
      502,
      "INVALID_RESPONSE",
      false,
      mayHaveSucceeded
    )
  }
}

function requireShipment(payload: unknown, mayHaveSucceeded: boolean): Shipment {
  const shipment = normalizeShipment(unwrapRecord(payload))
  if (shipment) return shipment
  throw new OzonApiError(
    "Ozon did not return a shipment identifier.",
    502,
    "INVALID_RESPONSE",
    false,
    mayHaveSucceeded
  )
}

function normalizeShipment(input: unknown): Shipment | null {
  if (!isRecord(input)) return null
  const value = unwrapRecord(input)
  const id = firstString(value, ["id", "shipment_id", "order_id", "posting_number"])
  if (!id) return null
  return {
    id,
    external_number: firstString(value, ["external_number", "external_id", "order_number"]),
    tracking_number: firstString(value, ["tracking_number", "track_number", "barcode"]),
    status: firstString(value, ["status", "state"]),
  }
}

function requireReturn(payload: unknown): Return {
  const value = unwrapRecord(payload)
  const id = firstString(value, ["id", "return_id", "order_id"])
  if (!id) {
    throw new OzonApiError(
      "Ozon did not return a return identifier.",
      502,
      "INVALID_RESPONSE",
      false,
      true
    )
  }
  return {
    id,
    shipment_id: firstString(value, ["shipment_id", "source_order_id"]),
    status: firstString(value, ["status", "state"]),
  }
}

function normalizeTariff(input: unknown): Tariff[] {
  if (!isRecord(input)) return []
  const code = firstStringOrNumber(input, ["code", "id", "tariff_id", "delivery_method_id"])
  const price = firstNumber(input, ["price", "amount", "cost", "delivery_price"])
  if (!code || price === null) return []
  return [{
    code,
    name: firstString(input, ["name", "title", "tariff_name"]) ?? code,
    price,
    currency: firstString(input, ["currency", "currency_code"]) ??
      nestedString(input, "price", ["currency", "currency_code"]) ?? "RUB",
    delivery_days_min: firstNumber(input, ["delivery_days_min", "period_min", "days_min"]),
    delivery_days_max: firstNumber(input, ["delivery_days_max", "period_max", "days_max"]),
    delivery_type: firstString(input, ["delivery_type", "type"]),
  }]
}

function normalizePickupPoint(input: unknown): PickupPoint[] {
  if (!isRecord(input)) return []
  const id = firstStringOrNumber(input, ["id", "point_id", "map_point_id", "code"])
  const addressValue = isRecord(input.address) ? input.address : input
  const address = firstString(addressValue, ["address", "full_address", "formatted", "address_full"])
  if (!id || !address) return []
  const location = isRecord(input.location) ? input.location : input
  return [{
    id,
    name: firstString(input, ["name", "title"]) ?? id,
    address,
    city: firstString(addressValue, ["city", "locality"]),
    latitude: firstNumber(location, ["latitude", "lat"]),
    longitude: firstNumber(location, ["longitude", "lon", "lng"]),
    working_hours: firstString(input, ["working_hours", "work_time", "schedule"]),
  }]
}

function extractCollection(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []
  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) return value
    if (isRecord(value)) {
      const nested = extractCollection(value, ["items", "orders", "points", "tariffs"])
      if (nested.length) return nested
    }
  }
  return []
}

function unwrapRecord(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {}
  for (const key of ["result", "shipment", "order", "return"]) {
    if (isRecord(payload[key])) return payload[key] as Record<string, unknown>
  }
  return payload
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return null
}

function firstStringOrNumber(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if ((typeof value === "string" && value.trim()) || typeof value === "number") {
      return String(value)
    }
  }
  return null
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (isRecord(value)) {
      const amount = value.amount
      if (typeof amount === "number" && Number.isFinite(amount)) return amount
      const units = value.units
      const nanos = value.nanos
      if ((typeof units === "number" || typeof units === "string") &&
        Number.isFinite(Number(units))) {
        return Number(units) + (typeof nanos === "number" ? nanos / 1_000_000_000 : 0)
      }
    }
  }
  return null
}

function nestedString(record: Record<string, unknown>, key: string, keys: string[]) {
  return isRecord(record[key]) ? firstString(record[key] as Record<string, unknown>, keys) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function invalidResponse(message: string) {
  return new OzonApiError(message, 502, "INVALID_RESPONSE", false, false)
}

function safeErrorCode(value: string | null, status: number) {
  return value && /^[A-Za-z0-9_.:-]{1,80}$/.test(value)
    ? value
    : `HTTP_${status}`
}

function requireIdempotencyKey(value: string) {
  if (!value.trim()) {
    throw new OzonApiError(
      "An idempotency key is required.",
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      false,
      false
    )
  }
}

function webhookSignature(headers: Headers | Record<string, string | string[] | undefined>) {
  const names = ["x-ozon-signature", "x-signature", "signature"]
  if (headers instanceof Headers) {
    return names.map((name) => headers.get(name)).find(Boolean) ?? null
  }
  const entries = Object.entries(headers)
  for (const name of names) {
    const value = entries.find(([key]) => key.toLowerCase() === name)?.[1]
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value[0] ?? null
  }
  return null
}

function filenameFromDisposition(value: string | null) {
  if (!value) return null
  const match = /filename\*?=(?:UTF-8''|["'])?([^"';]+)/i.exec(value)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

async function readLabelContent(response: Response) {
  try {
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    throw new OzonApiError(
      "Ozon label response could not be read.",
      502,
      isAbortError(error) ? "TIMEOUT" : "INVALID_RESPONSE",
      true,
      false
    )
  }
}

function resolveBaseUrl() {
  const configured = process.env.OZON_API_BASE_URL
  if (!configured) {
    throw new Error("OZON_API_BASE_URL must be configured explicitly.")
  }
  return configured
}

function normalizeBaseUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, "")
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error("Ozon base URL must be an absolute URL.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ozon base URL must use HTTP or HTTPS.")
  }
  return normalized
}

function positiveInteger(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback
}

function nonNegativeInteger(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback
}

function isAbortError(error: unknown) {
  return !!error && typeof error === "object" && "name" in error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
