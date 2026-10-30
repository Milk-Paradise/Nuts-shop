import { MedusaError } from "@medusajs/framework/utils"

import type { ShippingProviderCredentials } from "./credentials"

export interface CdekAuthorizationClient {
  testAuthorization(credentials: ShippingProviderCredentials): Promise<void>
}

export type CdekTariff = {
  code: number
  name: string
}

export type CdekCalculatedTariff = CdekTariff & {
  description: string | null
  delivery_mode: number
  delivery_sum: number
  period_min: number
  period_max: number
}

export type CdekCalculationInput = CdekTariffListInput & {
  recipient:
    | {
        city: string
        code?: number
        postal_code?: string | null
      }
    | {
        code: number
        city?: string
        postal_code?: string | null
      }
  tariff_codes: number[]
}

export type CdekCity = {
  code: number
  city: string
  country_code: string
  region: string
  region_code: number
}

export type CdekCitySearchInput = {
  country_code: string
  city: string
  region?: string
}

export type CdekDeliveryPoint = {
  code: string
  name: string
  type: string
  work_time: string | null
  location: {
    city: string
    city_code: number | null
    address: string
    address_full: string | null
    latitude: number | null
    longitude: number | null
  }
}

export type CdekTariffListInput = {
  contract_type: "online_store" | "delivery"
  sender: {
    city: string
    postal_code: string
  }
  package: {
    weight_grams: number
    length_mm: number
    width_mm: number
    height_mm: number
  }
}

export type CdekCreateOrderInput = {
  type: 1 | 2
  number: string
  tariff_code: number
  is_return?: boolean
  shipment_point?: string
  delivery_point?: string
  from_location: { city: string; postal_code?: string }
  // Опускается, когда задан delivery_point: СДЭК отвергает запрос, где указаны
  // и пункт выдачи, и адрес/город получателя одновременно.
  to_location?: { city: string; postal_code?: string; address?: string }
  recipient: { name: string; phones: Array<{ number: string }> }
  packages: Array<{
    number: string
    weight: number
    length: number
    width: number
    height: number
    items?: Array<{
      name: string
      ware_key: string
      payment: { value: number }
      cost: number
      amount: number
      weight: number
      return_item_detail?: {
        direct_order_uuid: string
        direct_package_number: string
      }
    }>
  }>
}

export type CdekCreatedOrder = {
  uuid: string
  cdek_number: string | null
}

export type CdekLabelRequest = {
  uuid: string
  url: string | null
}

export class CdekApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly mayHaveSucceeded = false
  ) {
    super(message)
    this.name = "CdekApiError"
  }
}

export class CdekClient implements CdekAuthorizationClient {
  constructor(
    private readonly baseUrl = normalizeCdekBaseUrl(
      process.env.CDEK_BASE_URL ??
        process.env.CDEK_API_BASE_URL ??
        "https://api.cdek.ru/v2"
    ),
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private async authorize(
    credentials: ShippingProviderCredentials,
    deadline = Date.now() + 8_000
  ) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
    })
    let response: Response

    try {
      response = await this.fetcher(`${this.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(remainingTimeout(deadline)),
      })
    } catch {
      throw new CdekApiError("СДЭК временно недоступен. Повторите попытку позже.", 502)
    }

    if (!response.ok) {
      throw new CdekApiError(
        response.status === 401
          ? "СДЭК отклонил client_id или client_secret. Проверьте реквизиты."
          : "Не удалось проверить реквизиты СДЭК.",
        response.status === 401 ? 400 : 502
      )
    }

    const payload = (await response.json()) as { access_token?: unknown }
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "CDEK authorization response did not contain an access token."
      )
    }

    return payload.access_token
  }

  async testAuthorization(credentials: ShippingProviderCredentials) {
    await this.authorize(credentials)
  }

  async listAvailableTariffs(
    credentials: ShippingProviderCredentials,
    input: CdekTariffListInput
  ): Promise<CdekTariff[]> {
    const accessToken = await this.authorize(credentials)
    let response: Response

    try {
      response = await this.fetcher(`${this.baseUrl}/calculator/tarifflist`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: input.contract_type === "online_store" ? 1 : 2,
          from_location: input.sender,
          to_location: input.sender,
          packages: [
            {
              weight: input.package.weight_grams,
              length: Math.ceil(input.package.length_mm / 10),
              width: Math.ceil(input.package.width_mm / 10),
              height: Math.ceil(input.package.height_mm / 10),
            },
          ],
        }),
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      throw new CdekApiError(
        "Авторизация прошла, но СДЭК не вернул список тарифов. Повторите попытку.",
        502
      )
    }

    if (!response.ok) {
      throw new CdekApiError(
        "Авторизация прошла, но СДЭК не вернул список тарифов. Повторите попытку.",
        502
      )
    }

    const payload = (await response.json()) as { tariff_codes?: unknown }
    if (!Array.isArray(payload.tariff_codes)) {
      throw new CdekApiError(
        "Авторизация прошла, но ответ СДЭК не содержит список тарифов. Повторите попытку.",
        502
      )
    }

    const tariffs = payload.tariff_codes.flatMap((item): CdekTariff[] => {
      if (!item || typeof item !== "object") {
        return []
      }
      const record = item as Record<string, unknown>
      return typeof record.tariff_code === "number" &&
        typeof record.tariff_name === "string" &&
        record.tariff_name.trim()
        ? [{ code: record.tariff_code, name: record.tariff_name }]
        : []
    })

    if (!tariffs.length) {
      throw new CdekApiError(
        "Авторизация прошла, но СДЭК не вернул доступные тарифы для договора. Повторите попытку.",
        502
      )
    }

    return tariffs
  }

  async calculateTariffs(
    credentials: ShippingProviderCredentials,
    input: CdekCalculationInput
  ): Promise<CdekCalculatedTariff[]> {
    const deadline = Date.now() + 8_000
    const accessToken = await this.authorize(credentials, deadline)
    const response = await this.requestWithTimeout(
      "/calculator/tarifflist",
      accessToken,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: input.contract_type === "online_store" ? 1 : 2,
          from_location: input.sender,
          to_location: {
            country_code: "RU",
            ...(typeof input.recipient.code === "number"
              ? { code: input.recipient.code }
              : { city: input.recipient.city }),
            ...(input.recipient.postal_code
              ? { postal_code: input.recipient.postal_code }
              : {}),
          },
          packages: [toCdekPackage(input.package)],
        }),
      },
      "Не удалось рассчитать доставку СДЭК. Повторите попытку позже.",
      deadline
    )

    const payload = (await readCdekJson(response)) as { tariff_codes?: unknown }
    if (!response.ok) {
      throw new CdekApiError(
        `Не удалось рассчитать доставку СДЭК. Повторите попытку позже. [HTTP ${response.status}] ${JSON.stringify(payload)}`,
        502
      )
    }

    if (!Array.isArray(payload.tariff_codes)) {
      throw new CdekApiError("СДЭК вернул некорректный ответ расчёта.", 502)
    }

    const selected = new Set(input.tariff_codes)
    return payload.tariff_codes.flatMap((item): CdekCalculatedTariff[] => {
      if (!item || typeof item !== "object") return []
      const value = item as Record<string, unknown>
      if (
        typeof value.tariff_code !== "number" ||
        !selected.has(value.tariff_code) ||
        typeof value.tariff_name !== "string" ||
        typeof value.delivery_mode !== "number" ||
        typeof value.delivery_sum !== "number" ||
        typeof value.period_min !== "number" ||
        typeof value.period_max !== "number"
      ) {
        return []
      }

      return [{
        code: value.tariff_code,
        name: value.tariff_name,
        description:
          typeof value.tariff_description === "string"
            ? value.tariff_description
            : null,
        delivery_mode: value.delivery_mode,
        delivery_sum: value.delivery_sum,
        period_min: value.period_min,
        period_max: value.period_max,
      }]
    })
  }

  async findCities(
    credentials: ShippingProviderCredentials,
    input: CdekCitySearchInput
  ): Promise<CdekCity[]> {
    const deadline = Date.now() + 8_000
    const accessToken = await this.authorize(credentials, deadline)
    const query = new URLSearchParams({
      country_codes: input.country_code,
      city: input.city,
    })
    if (input.region !== undefined) {
      query.set("region", input.region)
    }
    const response = await this.requestWithTimeout(
      `/location/cities?${query}`,
      accessToken,
      { method: "GET" },
      "Не удалось получить города СДЭК.",
      deadline
    )
    const payload = await readCdekJson(response)

    if (!response.ok || !Array.isArray(payload)) {
      throw new CdekApiError("Не удалось получить города СДЭК.", 502)
    }

    return payload.flatMap((item): CdekCity[] => {
      if (!item || typeof item !== "object") return []
      const value = item as Record<string, unknown>
      if (
        typeof value.code !== "number" ||
        typeof value.city !== "string" ||
        typeof value.country_code !== "string" ||
        typeof value.region !== "string" ||
        typeof value.region_code !== "number"
      ) return []

      return [{
        code: value.code,
        city: value.city,
        country_code: value.country_code,
        region: value.region,
        region_code: value.region_code,
      }]
    })
  }

  async listDeliveryPoints(
    credentials: ShippingProviderCredentials
  ): Promise<CdekDeliveryPoint[]> {
    const deadline = Date.now() + 8_000
    const accessToken = await this.authorize(credentials, deadline)
    const response = await this.requestWithTimeout(
      "/deliverypoints?country_code=RU",
      accessToken,
      {},
      "Не удалось обновить пункты выдачи СДЭК.",
      deadline
    )
    const payload = await readCdekJson(response)

    if (!response.ok || !Array.isArray(payload)) {
      throw new CdekApiError("Не удалось обновить пункты выдачи СДЭК.", 502)
    }

    return payload.flatMap((item): CdekDeliveryPoint[] => {
      if (!item || typeof item !== "object") return []
      const value = item as Record<string, unknown>
      const location = value.location
      if (
        typeof value.code !== "string" ||
        typeof value.name !== "string" ||
        typeof value.type !== "string" ||
        !location ||
        typeof location !== "object"
      ) return []
      const place = location as Record<string, unknown>
      if (typeof place.city !== "string" || typeof place.address !== "string") return []

      return [{
        code: value.code,
        name: value.name,
        type: value.type,
        work_time: typeof value.work_time === "string" ? value.work_time : null,
        location: {
          city: place.city,
          city_code: typeof place.city_code === "number" ? place.city_code : null,
          address: place.address,
          address_full: typeof place.address_full === "string" ? place.address_full : null,
          latitude: typeof place.latitude === "number" ? place.latitude : null,
          longitude: typeof place.longitude === "number" ? place.longitude : null,
        },
      }]
    })
  }

  async createOrder(
    credentials: ShippingProviderCredentials,
    input: CdekCreateOrderInput
  ): Promise<CdekCreatedOrder> {
    const deadline = Date.now() + 8_000
    const accessToken = await this.authorize(credentials, deadline)
    const response = await this.requestWithTimeout(
      "/orders",
      accessToken,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      "Не удалось создать отправку СДЭК. Повторите попытку позже.",
      deadline,
      true
    )
    let payload: {
      entity?: { uuid?: unknown; cdek_number?: unknown }
      requests?: Array<{ errors?: Array<{ message?: unknown }> }>
    }
    try {
      payload = await readCdekJson(response) as typeof payload
    } catch (error) {
      throw new CdekApiError(
        error instanceof Error ? error.message : "СДЭК вернул ответ в неизвестном формате.",
        502,
        true
      )
    }
    const message = payload.requests
      ?.flatMap((request) => request.errors ?? [])
      .map((error) => error.message)
      .find((value): value is string => typeof value === "string" && !!value)

    if (message) {
      // A structured request error is a definite business rejection: CDEK did
      // not create the order, so a corrected retry may safely POST again.
      throw new CdekApiError(message, 502, false)
    }
    if (!response.ok) {
      throw new CdekApiError("СДЭК не подтвердил создание отправки.", 502, true)
    }
    if (typeof payload.entity?.uuid !== "string" || !payload.entity.uuid) {
      throw new CdekApiError("СДЭК не вернул идентификатор созданной отправки.", 502, true)
    }

    return {
      uuid: payload.entity.uuid,
      cdek_number:
        typeof payload.entity.cdek_number === "string" && payload.entity.cdek_number
          ? payload.entity.cdek_number
          : null,
    }
  }

  // CDEK answers POST /orders with a uuid before it validates the order: the
  // verdict lands asynchronously in requests[].state. An order left INVALID is
  // not a shipment at all — it cannot even be deleted — so treating the POST
  // response as success would store a track number for something CDEK rejected.
  // Confirmed against the CDEK sandbox: a to-point tariff without
  // delivery_point answered 202 with a uuid, then went INVALID with
  // error_validate_receiver_delivery_point_is_empty.
  async confirmOrderCreation(
    credentials: ShippingProviderCredentials,
    orderUuid: string,
    attempts = 2,
    pauseMs = 1_500
  ): Promise<CdekCreatedOrder> {
    let last: CdekCreatedOrder = { uuid: orderUuid, cdek_number: null }

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, pauseMs))
      const deadline = Date.now() + 8_000
      const accessToken = await this.authorize(credentials, deadline)
      const response = await this.requestWithTimeout(
        `/orders/${encodeURIComponent(orderUuid)}`,
        accessToken,
        {},
        "Не удалось проверить созданную отправку СДЭК.",
        deadline
      )
      const payload = await readCdekJson(response) as {
        entity?: { cdek_number?: unknown }
        requests?: Array<{
          type?: unknown
          state?: unknown
          errors?: Array<{ message?: unknown; code?: unknown }>
        }>
      }
      const createRequest = payload.requests?.find((request) => request.type === "CREATE")
      const cdekNumber =
        typeof payload.entity?.cdek_number === "string" && payload.entity.cdek_number
          ? payload.entity.cdek_number
          : null
      last = { uuid: orderUuid, cdek_number: cdekNumber }

      if (createRequest?.state === "INVALID") {
        const reason = createRequest.errors
          ?.map((error) => error.message ?? error.code)
          .find((value): value is string => typeof value === "string" && !!value)
        throw new CdekApiError(reason ?? "СДЭК отклонил отправку как некорректную.", 502, false)
      }
      if (createRequest?.state === "SUCCESSFUL") return last
    }

    // Still pending: the order exists and may yet become valid, so this is not a
    // rejection — the caller keeps the uuid and reconciliation continues later.
    return last
  }

  async findOrderByNumber(
    credentials: ShippingProviderCredentials,
    number: string
  ): Promise<CdekCreatedOrder | null> {
    const deadline = Date.now() + 8_000
    const accessToken = await this.authorize(credentials, deadline)
    const response = await this.requestWithTimeout(
      `/orders?im_number=${encodeURIComponent(number)}`,
      accessToken,
      {},
      "Не удалось проверить существующую отправку СДЭК.",
      deadline
    )
    if (response.status === 404) return null
    const payload = await readCdekJson(response) as {
      entity?: { uuid?: unknown; cdek_number?: unknown }
    }
    if (!response.ok) {
      throw new CdekApiError("Не удалось проверить существующую отправку СДЭК.", 502)
    }
    if (typeof payload.entity?.uuid !== "string" || !payload.entity.uuid) return null
    return {
      uuid: payload.entity.uuid,
      cdek_number:
        typeof payload.entity.cdek_number === "string" && payload.entity.cdek_number
          ? payload.entity.cdek_number
          : null,
    }
  }

  async deleteOrder(
    credentials: ShippingProviderCredentials,
    orderUuid: string
  ): Promise<void> {
    const deadline = Date.now() + 8_000
    const accessToken = await this.authorize(credentials, deadline)
    const response = await this.requestWithTimeout(
      `/orders/${encodeURIComponent(orderUuid)}`,
      accessToken,
      { method: "DELETE" },
      "Не удалось отменить отправку СДЭК. Повторите попытку позже.",
      deadline
    )
    if (response.status === 204) return

    const payload = await readCdekJson(response) as {
      requests?: Array<{ errors?: Array<{ message?: unknown }> }>
    }
    const message = payload.requests?.flatMap((request) => request.errors ?? [])
      .map((error) => error.message)
      .find((value): value is string => typeof value === "string" && !!value)
    if (!response.ok || message) {
      throw new CdekApiError(
        message ?? "СДЭК отклонил отмену отправки. Повторите попытку позже.",
        response.status || 502
      )
    }
  }

  async requestBarcodeLabel(
    credentials: ShippingProviderCredentials,
    orderUuid: string
  ): Promise<CdekLabelRequest> {
    const deadline = Date.now() + 8_000
    const accessToken = await this.authorize(credentials, deadline)
    const response = await this.requestWithTimeout(
      "/print/barcodes",
      accessToken,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orders: [{ order_uuid: orderUuid }],
          copy_count: 1,
          format: "A6",
          lang: "RUS",
        }),
      },
      "Не удалось запросить этикетку СДЭК.",
      deadline
    )
    const payload = await readCdekJson(response) as {
      entity?: { uuid?: unknown; url?: unknown }
      requests?: Array<{ errors?: Array<{ message?: unknown }> }>
    }
    const message = payload.requests?.flatMap((request) => request.errors ?? [])
      .map((error) => error.message)
      .find((value): value is string => typeof value === "string" && !!value)
    if (!response.ok || message) {
      throw new CdekApiError(message ?? "Не удалось запросить этикетку СДЭК.", 502)
    }
    if (typeof payload.entity?.uuid !== "string" || !payload.entity.uuid) {
      throw new CdekApiError("СДЭК не вернул идентификатор печатной формы.", 502)
    }
    return {
      uuid: payload.entity.uuid,
      url: typeof payload.entity.url === "string" && payload.entity.url
        ? payload.entity.url
        : null,
    }
  }

  async downloadBarcodeLabel(
    credentials: ShippingProviderCredentials,
    requestUuid: string
  ): Promise<Buffer> {
    const deadline = Date.now() + 8_000
    const accessToken = await this.authorize(credentials, deadline)
    const response = await this.requestWithTimeout(
      `/print/barcodes/${encodeURIComponent(requestUuid)}.pdf`,
      accessToken,
      {},
      "Не удалось скачать этикетку СДЭК.",
      deadline
    )
    if (response.status === 404 || response.status === 202) {
      throw new CdekApiError(
        "Этикетка ещё не готова у СДЭК. Подождите минуту и повторите попытку.",
        409
      )
    }
    if (!response.ok) {
      throw new CdekApiError("Не удалось скачать этикетку СДЭК.", 502)
    }
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("application/pdf")) {
      throw new CdekApiError(
        "Этикетка ещё не готова у СДЭК. Подождите минуту и повторите попытку.",
        409
      )
    }
    return Buffer.from(await response.arrayBuffer())
  }

  private async requestWithTimeout(
    path: string,
    accessToken: string,
    init: RequestInit,
    errorMessage: string,
    deadline = Date.now() + 8_000,
    mayHaveSucceeded = false
  ) {
    try {
      return await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...init.headers,
        },
        signal: AbortSignal.timeout(remainingTimeout(deadline)),
      })
    } catch {
      throw new CdekApiError(errorMessage, 502, mayHaveSucceeded)
    }
  }
}

function remainingTimeout(deadline: number) {
  return Math.max(1, deadline - Date.now())
}

function normalizeCdekBaseUrl(value: string) {
  const base = value.replace(/\/+$/, "")
  return base.endsWith("/v2") ? base : `${base}/v2`
}

function toCdekPackage(input: CdekTariffListInput["package"]) {
  return {
    weight: input.weight_grams,
    length: Math.ceil(input.length_mm / 10),
    width: Math.ceil(input.width_mm / 10),
    height: Math.ceil(input.height_mm / 10),
  }
}

async function readCdekJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new CdekApiError("СДЭК вернул ответ в неизвестном формате.", 502)
  }
}
