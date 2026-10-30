import {
  decryptMoyskladCredentials,
  MoyskladCredentialsReentryError,
  type MoyskladCredentials,
} from "./credentials"

export const DEFAULT_MOYSKLAD_BASE_URL =
  "https://api.moysklad.ru/api/remap/1.2"

export const MOYSKLAD_STOCK_PAGE_SIZE = 1000
export const MOYSKLAD_RATE_LIMIT = {
  maxWeight: 45,
  intervalMs: 3_000,
  stockReportWeight: 5,
} as const
export const MOYSKLAD_MAX_RATE_LIMIT_RETRIES = 3
export const MOYSKLAD_RETRY_FALLBACK_MS = 3_000
export const MOYSKLAD_REQUEST_TIMEOUT_MS = 30_000

export type MoyskladMetaRef = {
  meta: { href: string; type: string; mediaType: "application/json" }
}

export type MoyskladFetchResponse = {
  ok: boolean
  status: number
  headers?: { get(name: string): string | null }
  text(): Promise<string>
  json?(): Promise<unknown>
}

export type MoyskladFetch = (
  input: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: string
    signal?: AbortSignal
  }
) => Promise<MoyskladFetchResponse>

export class MoyskladApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = "MoyskladApiError"
  }
}

export function isMoyskladCredentialsFailure(error: unknown) {
  return (
    error instanceof MoyskladCredentialsReentryError ||
    (error instanceof MoyskladApiError &&
      (error.status === 401 || error.status === 403))
  )
}

function authorizationHeader(credentials: MoyskladCredentials) {
  if (credentials.type === "token") {
    return `Bearer ${credentials.token}`
  }

  return `Basic ${Buffer.from(
    `${credentials.login}:${credentials.password}`
  ).toString("base64")}`
}

function metaRef(href: string, type: string): MoyskladMetaRef {
  return { meta: { href, type, mediaType: "application/json" } }
}

export function formatMoyskladMoment(date: Date) {
  const base = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(date)
  return `${base}.${String(date.getUTCMilliseconds()).padStart(3, "0")}`
}

export type MoyskladOrganization = { id: string; meta: { href: string } }
export type MoyskladCounterparty = {
  id: string
  meta: { href: string }
  email?: string
}
export type MoyskladProduct = {
  id: string
  meta: { href: string }
  name?: string
  code?: string
  article?: string
}

export type MoyskladProductBatch = {
  rows: MoyskladProduct[]
  offset: number
  total: number
}

export type MoyskladStockRow = {
  meta: { href: string; type?: string }
  name?: string
  code?: string
  article?: string
  stock: number
  reserve?: number
}

export type MoyskladStockBatch = {
  rows: MoyskladStockRow[]
  offset: number
  total: number
}

type MoyskladRateLimiterOptions = {
  maxWeight?: number
  intervalMs?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

export type MoyskladThrottle = (weight?: number) => Promise<void>

export function createMoyskladRateLimiter(
  options: MoyskladRateLimiterOptions = {}
): MoyskladThrottle {
  const maxWeight = options.maxWeight ?? MOYSKLAD_RATE_LIMIT.maxWeight
  const intervalMs = options.intervalMs ?? MOYSKLAD_RATE_LIMIT.intervalMs
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const admissions: Array<{ at: number; weight: number }> = []
  let admissionQueue = Promise.resolve()

  return function throttle(weight = 1) {
    const admission = admissionQueue.then(async () => {
      if (!Number.isFinite(weight) || weight <= 0 || weight > maxWeight) {
        throw new MoyskladApiError(
          `MoySklad request weight must be between 1 and ${maxWeight}.`
        )
      }

      let currentTime = now()

      while (true) {
        while (
          admissions.length &&
          admissions[0].at <= currentTime - intervalMs
        ) {
          admissions.shift()
        }

        const admittedWeight = admissions.reduce(
          (total, entry) => total + entry.weight,
          0
        )

        if (admittedWeight + weight <= maxWeight) {
          admissions.push({ at: currentTime, weight })
          return
        }

        const waitFor = admissions[0].at + intervalMs - currentTime
        await sleep(Math.max(waitFor, 0))
        currentTime = now()
      }
    })

    admissionQueue = admission.catch(() => undefined)
    return admission
  }
}

const sharedMoyskladRateLimiter = createMoyskladRateLimiter()

type MoyskladClientOptions = {
  throttle?: MoyskladThrottle
  retrySleep?: (milliseconds: number) => Promise<void>
  requestTimeoutMs?: number
}

export function resolveMoyskladBaseUrl(
  environment: NodeJS.ProcessEnv = process.env
): string {
  return (
    environment.MOYSKLAD_BASE_URL?.trim().replace(/\/+$/, "") ||
    DEFAULT_MOYSKLAD_BASE_URL
  )
}

export function resolveMoyskladRequestTimeoutMs(
  environment: NodeJS.ProcessEnv = process.env
): number {
  const configured = environment.MOYSKLAD_REQUEST_TIMEOUT_MS?.trim()
  const parsed = configured ? Number(configured) : Number.NaN

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : MOYSKLAD_REQUEST_TIMEOUT_MS
}

export type MoyskladOrderPosition = {
  assortmentHref: string
  quantity: number
  priceRubles?: number
}

export type MoyskladOrder = { id: string; meta: { href: string } }
export type MoyskladDemand = { id: string; meta: { href: string } }
export type MoyskladPayment = {
  id: string
  externalCode?: string
  meta: { href: string }
  sum?: number
  moment?: string
  operations?: Array<{ meta?: { href?: string }; linkedSum?: number }>
  rate?: { currency?: { meta?: { href?: string }; isoCode?: string } }
}

export class MoyskladClient {
  private readonly throttle: MoyskladThrottle
  private readonly retrySleep: (milliseconds: number) => Promise<void>
  private readonly requestTimeoutMs: number
  private readonly baseUrl: string

  constructor(
    private readonly fetch: MoyskladFetch = globalThis.fetch,
    options: MoyskladClientOptions = {}
  ) {
    this.throttle = options.throttle ?? sharedMoyskladRateLimiter
    this.retrySleep =
      options.retrySleep ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? resolveMoyskladRequestTimeoutMs()
    this.baseUrl = resolveMoyskladBaseUrl()
  }

  async testConnection(encryptedCredentials: string) {
    return this.testCredentials(decryptMoyskladCredentials(encryptedCredentials))
  }

  async testCredentials(credentials: MoyskladCredentials) {
    let response: MoyskladFetchResponse

    try {
      response = await this.fetchWithRateLimitRetries(
        `${this.baseUrl}/context/employee`,
        {
          method: "GET",
          headers: {
            Accept: "application/json;charset=utf-8",
            Authorization: authorizationHeader(credentials),
          },
        },
        1
      )
    } catch (error) {
      if (error instanceof MoyskladApiError) {
        throw error
      }

      throw new MoyskladApiError("Не удалось проверить доступ к МойСклад.")
    }

    if (!response.ok) {
      let message: string

      try {
        message = await response.text()
      } catch {
        throw new MoyskladApiError("Не удалось проверить доступ к МойСклад.")
      }

      throw new MoyskladApiError(
        message || "Не удалось проверить доступ к МойСклад.",
        response.status
      )
    }

    if (response.status !== 204) {
      try {
        response.json
          ? await response.json()
          : JSON.parse(await response.text())
      } catch {
        throw new MoyskladApiError(
          "МойСклад вернул успешный статус с некорректным JSON.",
          response.status
        )
      }
    }

    return { success: true as const }
  }

  async findDefaultOrganization(encryptedCredentials: string) {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)
    const result = (await this.request(
      credentials,
      "GET",
      "/entity/organization?limit=1"
    )) as { rows?: MoyskladOrganization[] }

    const organization = result.rows?.[0]

    if (!organization) {
      throw new MoyskladApiError(
        "В МойСклад не настроено ни одной организации."
      )
    }

    return organization
  }

  async findCounterpartyByEmail(encryptedCredentials: string, email: string) {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)
    const result = (await this.request(
      credentials,
      "GET",
      `/entity/counterparty?filter=${encodeURIComponent(`email=${email}`)}&limit=1`
    )) as { rows?: MoyskladCounterparty[] }

    return result.rows?.[0] ?? null
  }

  async createCounterparty(
    encryptedCredentials: string,
    input: { name: string; email?: string; phone?: string }
  ) {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)

    return (await this.request(
      credentials,
      "POST",
      "/entity/counterparty",
      {
        name: input.name,
        companyType: "individual",
        email: input.email,
        phone: input.phone,
      }
    )) as MoyskladCounterparty
  }

  async findProductsBySku(encryptedCredentials: string, sku: string) {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)
    const result = (await this.request(
      credentials,
      "GET",
      `/entity/product?filter=${encodeURIComponent(`code=${sku}`)}&limit=2`
    )) as { rows?: MoyskladProduct[] }

    return result.rows ?? []
  }

  async *getStockBatches(
    encryptedCredentials: string,
    options: {
      pageSize?: number
    } = {}
  ): AsyncGenerator<MoyskladStockBatch> {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)
    const pageSize = options.pageSize ?? MOYSKLAD_STOCK_PAGE_SIZE
    let offset = 0

    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MOYSKLAD_STOCK_PAGE_SIZE
    ) {
      throw new MoyskladApiError(
        `MoySklad stock page size must be between 1 and ${MOYSKLAD_STOCK_PAGE_SIZE}.`
      )
    }

    while (true) {
      const result = (await this.request(
        credentials,
        "GET",
        `/report/stock/all?limit=${pageSize}&offset=${offset}`
      )) as {
        meta?: { size?: number }
        rows?: MoyskladStockRow[]
      }
      const rows = result.rows ?? []
      const total = result.meta?.size ?? offset + rows.length

      yield { rows, offset, total }

      offset += rows.length

      if (!rows.length || offset >= total || rows.length < pageSize) {
        return
      }
    }
  }

  async *getProductBatches(
    encryptedCredentials: string,
    options: {
      pageSize?: number
    } = {}
  ): AsyncGenerator<MoyskladProductBatch> {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)
    const pageSize = options.pageSize ?? MOYSKLAD_STOCK_PAGE_SIZE
    let offset = 0

    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MOYSKLAD_STOCK_PAGE_SIZE
    ) {
      throw new MoyskladApiError(
        `MoySklad product page size must be between 1 and ${MOYSKLAD_STOCK_PAGE_SIZE}.`
      )
    }

    while (true) {
      const result = (await this.request(
        credentials,
        "GET",
        `/entity/product?limit=${pageSize}&offset=${offset}`
      )) as {
        meta?: { size?: number }
        rows?: MoyskladProduct[]
      }
      const rows = result.rows ?? []
      const total = result.meta?.size ?? offset + rows.length

      yield { rows, offset, total }

      offset += rows.length

      if (!rows.length || offset >= total || rows.length < pageSize) {
        return
      }
    }
  }

  async createCustomerOrder(
    encryptedCredentials: string,
    input: {
      organizationHref: string
      agentHref: string
      description?: string
      positions: MoyskladOrderPosition[]
    }
  ) {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)

    const order = (await this.request(credentials, "POST", "/entity/customerorder", {
      organization: metaRef(input.organizationHref, "organization"),
      agent: metaRef(input.agentHref, "counterparty"),
      description: input.description,
      positions: input.positions.map((position) => ({
        quantity: position.quantity,
        assortment: metaRef(position.assortmentHref, "product"),
        ...(position.priceRubles !== undefined
          ? { price: Math.round(position.priceRubles * 100) }
          : {}),
      })),
    })) as Partial<MoyskladOrder>

    if (typeof order.id !== "string" || !order.id.trim()) {
      throw new MoyskladApiError(
        "МойСклад не вернул идентификатор созданного заказа."
      )
    }

    return order as MoyskladOrder
  }

  async markCustomerOrderCancelled(
    encryptedCredentials: string,
    moyskladOrderId: string,
    description: string
  ) {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)

    return (await this.request(
      credentials,
      "PUT",
      `/entity/customerorder/${moyskladOrderId}`,
      { description }
    )) as MoyskladOrder
  }

  async findDemandByExternalCode(encryptedCredentials: string, externalCode: string) {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)
    const result = (await this.request(
      credentials,
      "GET",
      `/entity/demand?filter=${encodeURIComponent(`externalCode=${externalCode}`)}&limit=2`
    )) as { rows?: MoyskladDemand[] }

    const rows = result.rows ?? []
    if (rows.length > 1) {
      throw new MoyskladApiError(`В МойСклад найдено несколько отгрузок с внешним кодом ${externalCode}.`)
    }
    return rows[0] ?? null
  }

  async createCustomerOrderDemand(
    encryptedCredentials: string,
    input: { customerOrderId: string; externalCode: string }
  ) {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)
    const order = (await this.request(
      credentials,
      "GET",
      `/entity/customerorder/${input.customerOrderId}?expand=positions`
    )) as {
      meta?: { href?: string }
      organization?: MoyskladMetaRef
      agent?: MoyskladMetaRef
      positions?: Array<{ quantity?: number; price?: number; assortment?: MoyskladMetaRef }>
    }

    if (!order.organization?.meta?.href || !order.agent?.meta?.href) {
      throw new MoyskladApiError("Заказ МойСклад не содержит организацию или контрагента.")
    }
    if (!order.meta?.href || !order.positions?.length) {
      throw new MoyskladApiError("Заказ МойСклад не содержит ссылку или позиции для отгрузки.")
    }

    const demand = (await this.request(credentials, "POST", "/entity/demand", {
      externalCode: input.externalCode,
      organization: order.organization,
      agent: order.agent,
      customerOrder: metaRef(order.meta.href, "customerorder"),
      positions: order.positions.map((position) => ({
        quantity: position.quantity,
        assortment: position.assortment,
        ...(position.price !== undefined ? { price: position.price } : {}),
      })),
    })) as Partial<MoyskladDemand>

    if (typeof demand.id !== "string" || !demand.id.trim()) {
      throw new MoyskladApiError("МойСклад не вернул идентификатор созданной отгрузки.")
    }
    return demand as MoyskladDemand
  }

  async findIncomingPaymentByExternalCode(encryptedCredentials: string, externalCode: string) {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)
    const result = (await this.request(
      credentials,
      "GET",
      `/entity/paymentin?filter=${encodeURIComponent(`externalCode=${externalCode}`)}&limit=2&expand=operations,rate.currency`
    )) as { rows?: MoyskladPayment[] }

    const rows = result.rows ?? []
    if (rows.length > 1) {
      throw new MoyskladApiError(`В МойСклад найдено несколько платежей с внешним кодом ${externalCode}.`)
    }
    return rows[0] ?? null
  }

  async createIncomingPayment(
    encryptedCredentials: string,
    input: { externalCode: string; customerOrderId: string; amount: number; currencyCode: string; paidAt: Date }
  ) {
    const credentials = decryptMoyskladCredentials(encryptedCredentials)
    const customerOrderHref = `${this.baseUrl}/entity/customerorder/${input.customerOrderId}`
    const order = (await this.request(credentials, "GET", `/entity/customerorder/${input.customerOrderId}`)) as {
      organization?: MoyskladMetaRef
      agent?: MoyskladMetaRef
    }
    if (!order.organization?.meta?.href || !order.agent?.meta?.href) {
      throw new MoyskladApiError("Заказ МойСклад не содержит организацию или контрагента.")
    }
    const currencyResult = (await this.request(
      credentials,
      "GET",
      `/entity/currency?filter=${encodeURIComponent(`isoCode=${input.currencyCode.toUpperCase()}`)}&limit=2`
    )) as { rows?: Array<{ meta: { href: string } }> }
    const currency = currencyResult.rows?.[0]
    if (!currency || (currencyResult.rows?.length ?? 0) !== 1) {
      throw new MoyskladApiError(`Валюта ${input.currencyCode.toUpperCase()} не найдена в МойСклад однозначно.`)
    }

    const payment = (await this.request(credentials, "POST", "/entity/paymentin", {
      externalCode: input.externalCode,
      moment: formatMoyskladMoment(input.paidAt),
      organization: order.organization,
      agent: order.agent,
      sum: Math.round(input.amount * 100),
      rate: { currency: metaRef(currency.meta.href, "currency") },
      operations: [{ meta: metaRef(customerOrderHref, "customerorder").meta, linkedSum: Math.round(input.amount * 100) }]
    })) as Partial<MoyskladPayment>

    if (typeof payment.id !== "string" || !payment.id.trim()) {
      throw new MoyskladApiError("МойСклад не вернул идентификатор созданного платежа.")
    }
    return payment as MoyskladPayment
  }

  private async request(
    credentials: MoyskladCredentials,
    method: string,
    path: string,
    body?: Record<string, unknown>
  ) {
    let response: MoyskladFetchResponse

    try {
      response = await this.fetchWithRateLimitRetries(
        `${this.baseUrl}${path}`,
        {
          method,
          headers: {
            Accept: "application/json;charset=utf-8",
            "Content-Type": "application/json",
            Authorization: authorizationHeader(credentials),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
        path.startsWith("/report/stock/all")
          ? MOYSKLAD_RATE_LIMIT.stockReportWeight
          : 1
      )
    } catch (error) {
      if (error instanceof MoyskladApiError) {
        throw error
      }

      throw new MoyskladApiError("Не удалось выполнить запрос к МойСклад.")
    }

    if (!response.ok) {
      let message: string

      try {
        message = await response.text()
      } catch {
        throw new MoyskladApiError("Не удалось выполнить запрос к МойСклад.")
      }

      throw new MoyskladApiError(
        message || "Не удалось выполнить запрос к МойСклад.",
        response.status
      )
    }

    if (response.status === 204) {
      return {}
    }

    try {
      return response.json ? await response.json() : JSON.parse(await response.text())
    } catch {
      throw new MoyskladApiError(
        "МойСклад вернул успешный статус с некорректным JSON.",
        response.status
      )
    }
  }

  private async fetchWithRateLimitRetries(
    input: string,
    init: Parameters<MoyskladFetch>[1],
    weight: number
  ): Promise<MoyskladFetchResponse> {
    for (let retry = 0; ; retry += 1) {
      await this.throttle(weight)
      const abortController = new AbortController()
      const timeout = setTimeout(
        () => abortController.abort(),
        this.requestTimeoutMs
      )
      let response: MoyskladFetchResponse

      try {
        response = await this.fetch(input, {
          ...init,
          signal: abortController.signal,
        })
      } catch (error) {
        if (abortController.signal.aborted) {
          throw new MoyskladApiError(
            `МойСклад не ответил за ${this.requestTimeoutMs} мс.`
          )
        }

        throw error
      } finally {
        clearTimeout(timeout)
      }

      if (
        response.status !== 429 ||
        retry >= MOYSKLAD_MAX_RATE_LIMIT_RETRIES
      ) {
        return response
      }

      const retryHeader = response.headers?.get("x-lognex-retry-after")
      const retryAfter = !retryHeader?.trim()
        ? Number.NaN
        : Number(retryHeader)
      await this.retrySleep(
        Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter
          : MOYSKLAD_RETRY_FALLBACK_MS
      )
    }
  }
}
