import { execFile } from "node:child_process"
import { createHash } from "node:crypto"

import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"

import { createMoyskladRateLimiter } from "../modules/moysklad-integration/client"
import type { MoyskladCredentials } from "../modules/moysklad-integration/credentials"
import {
  applyMoyskladCatalogProductWorkflow,
  type ApplyMoyskladCatalogProductInput,
} from "../workflows/apply-moysklad-catalog-product"

const MOYSKLAD_API_URL = "https://api.moysklad.ru/api/remap/1.2"
const MOYSKLAD_ACCEPT = "application/json;charset=utf-8"
const MOYSKLAD_CATALOG_PAGE_SIZE = 100
const MOYSKLAD_MAX_429_RETRIES = 5
const MOYSKLAD_RATE_LIMIT = { maxRequests: 45, intervalMs: 3_000 }
const PUBLIC_SALE_PRICE_NAME = "Цена продажи"
const STOREFRONT_SALES_CHANNEL_NAME = "Auto Paint Storefront"
const DEFAULT_VARIANT_OPTION = "Default"

type Logger = { info(message: string): void }

type MoyskladHeaders = { get(name: string): string | null }

type MoyskladHttpResponse = {
  ok: boolean
  status: number
  headers: MoyskladHeaders
  text(): Promise<string>
  json?(): Promise<unknown>
  arrayBuffer?(): Promise<ArrayBuffer>
}

type MoyskladFetch = (
  input: string,
  init: {
    method: string
    headers: Record<string, string>
  }
) => Promise<MoyskladHttpResponse>

type MoyskladAuth = MoyskladCredentials | { type: "token"; token: string }

type MoyskladSalePrice = {
  value?: number
  priceType?: { name?: string }
}

type MoyskladImagesMeta = {
  href: string
  size?: number
}

type MoyskladBarcode = Record<string, string | undefined>

export type MoyskladCatalogCharacteristic = {
  name?: string
  value?: string
}

export type MoyskladCatalogVariant = {
  id?: string
  name?: string
  code?: string
  salePrices?: MoyskladSalePrice[]
  barcodes?: MoyskladBarcode[]
  weight?: number
  volume?: number
  characteristics?: MoyskladCatalogCharacteristic[]
}

export type MoyskladCatalogProduct = {
  id: string
  name: string
  code?: string
  description?: string
  archived?: boolean
  pathName?: string
  salePrices?: MoyskladSalePrice[]
  images?: { meta?: MoyskladImagesMeta }
  weight?: number
  volume?: number
  barcodes?: MoyskladBarcode[]
  variants?: MoyskladCatalogVariant[]
  brand?: { name?: string }
  tags?: Array<{ name?: string }>
  attributes?: MoyskladCatalogCharacteristic[]
}

type MoyskladImage = {
  filename?: string
  meta: {
    href: string
    downloadHref?: string
  }
}

export type ExistingSkuMatch = {
  variantId: string
  productId: string
  sku: string
  metadata?: Record<string, unknown> | null
}

export type ExistingCategory = {
  id: string
  name: string
  handle: string
  parentCategoryId: string | null
}

type ExistingProduct = {
  id: string
  metadata: Record<string, unknown> | null
  salesChannelIds: string[]
  images: {
    id: string
    url: string
    metadata: Record<string, unknown> | null
  }[]
}

type ApplyContext = {
  salesChannelId: string
  shippingProfileId: string
}

type ImportAction = "create" | "update" | "archive"

type PriceSelection =
  | { rawKopecks: number; amountRubles: number }
  | { reason: "missing_sale_price" | "zero_sale_price" }

export type CatalogImportItem = {
  action: ImportAction
  source: MoyskladCatalogProduct
  sku: string
  rawKopecks: number
  amountRubles: number
  categoryPath: string[]
  variant?: MoyskladCatalogVariant
  match?: ExistingSkuMatch
}

type SkipReason =
  | "archived"
  | "missing_code"
  | "missing_sale_price"
  | "zero_sale_price"
  | "duplicate_source_sku"
  | "ambiguous_medusa_sku"
  | "processing_error"

type SkipCounts = Record<SkipReason, number>

export type CatalogImportPlan = {
  items: CatalogImportItem[]
  skipped: SkipCounts
  productsWithoutImages: string[]
  productsWithoutPrice: string[]
  priceExamples: {
    sku: string
    name: string
    rawKopecks: number
    amountRubles: number
  }[]
}

export type PlannedCategory = {
  name: string
  handle: string
  fullPath: string[]
  parentPath: string[] | null
}

export type CategoryPlan = {
  missing: PlannedCategory[]
  categoryIdByPath: Map<string, string>
}

type CatalogReader = {
  loadSkuMatches(skus: string[]): Promise<Map<string, ExistingSkuMatch[]>>
  loadCategories(): Promise<ExistingCategory[]>
  loadProduct?(productId: string): Promise<ExistingProduct>
  loadApplyContext?(): Promise<ApplyContext>
}

type CatalogImportReport = {
  mode: "dry-run" | "apply"
  sourceTotal: number
  created: number
  updated: number
  skipped: SkipCounts
  categories: string[]
  productsWithoutImages: string[]
  productsWithoutPrice: string[]
  imageFailures: string[]
  processingErrors: string[]
  priceExamples: CatalogImportPlan["priceExamples"]
}

type RunImportOptions = {
  apply: boolean
  token?: string
  credentials?: MoyskladCredentials
  reader: CatalogReader
  writer?: MedusaCatalogWriter
  logger: Logger
  fetch?: MoyskladFetch
  throttle?: () => Promise<void>
  sleep?: (milliseconds: number) => Promise<void>
}

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: Record<string, unknown>
  }): Promise<{
    data: Record<string, unknown>[]
    metadata?: { count?: number }
  }>
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function cleanLine(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").trim()
}

function productReference(product: MoyskladCatalogProduct, sku?: string) {
  return `${sku || "(без SKU)"} — ${cleanLine(product.name)}`
}

function categoryPathKey(path: string[]) {
  return JSON.stringify(path)
}

function shortHash(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 10)
}

function toHandle(value: string) {
  const handle = value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  return handle || `category-${shortHash(value)}`
}

function productHandle(product: MoyskladCatalogProduct, sku: string) {
  const base = toHandle(`moysklad-${sku}`).slice(0, 220).replace(/-$/g, "")
  return `${base}-${shortHash(product.id)}`
}

function createSkipCounts(): SkipCounts {
  return {
    archived: 0,
    missing_code: 0,
    missing_sale_price: 0,
    zero_sale_price: 0,
    duplicate_source_sku: 0,
    ambiguous_medusa_sku: 0,
    processing_error: 0,
  }
}

function isSelectedPrice(
  selection: PriceSelection
): selection is { rawKopecks: number; amountRubles: number } {
  return "rawKopecks" in selection
}

export function readMoyskladEnvironment(
  environment: Record<string, string | undefined>
) {
  const token = environment.MOYSKLAD_TOKEN
  const encryptionKey = environment.MOYSKLAD_ENCRYPTION_KEY

  if (!token?.trim() || !encryptionKey?.trim()) {
    throw new Error(
      "Не заданы обязательные переменные MOYSKLAD_TOKEN и MOYSKLAD_ENCRYPTION_KEY. Запрос к API не выполнялся."
    )
  }

  return { token }
}

export function selectSalePrice(
  product: MoyskladCatalogProduct,
  variant?: MoyskladCatalogVariant
): PriceSelection {
  const publicPrice = (variant?.salePrices ?? product.salePrices)?.find(
    (price) => price.priceType?.name === PUBLIC_SALE_PRICE_NAME
  )

  if (!publicPrice || !Number.isFinite(publicPrice.value)) {
    return { reason: "missing_sale_price" }
  }

  if ((publicPrice.value as number) <= 0) {
    return { reason: "zero_sale_price" }
  }

  const rawKopecks = publicPrice.value as number

  return {
    rawKopecks,
    amountRubles: rawKopecks / 100,
  }
}

export function parseCategoryPath(pathName?: string) {
  return (pathName ?? "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function firstBarcode(product: MoyskladCatalogProduct, variant?: MoyskladCatalogVariant) {
  const priorities = ["ean13", "ean8", "gtin", "upc", "code128", "qr"]

  for (const barcode of variant?.barcodes ?? product.barcodes ?? []) {
    for (const key of priorities) {
      const value = barcode[key]
      if (value?.trim()) {
        return value.trim()
      }
    }

    const fallback = Object.values(barcode).find((value) => value?.trim())
    if (fallback) {
      return fallback.trim()
    }
  }

  return undefined
}

function sourceEntries(product: MoyskladCatalogProduct) {
  const variants = product.variants?.length ? product.variants : [undefined]
  return variants.map((variant) => ({
    variant,
    sku: variant?.code?.trim() || (!variant ? product.code?.trim() : undefined),
  }))
}

export function buildCatalogImportPlan(
  products: MoyskladCatalogProduct[],
  matchesBySku: Map<string, ExistingSkuMatch[]>
): CatalogImportPlan {
  const skipped = createSkipCounts()
  const items: CatalogImportItem[] = []
  const productsWithoutImages: string[] = []
  const productsWithoutPrice: string[] = []
  const sourceSkuCounts = new Map<string, number>()

  for (const product of products) {
    if (product.archived) continue
    for (const { sku } of sourceEntries(product)) {
      if (sku) sourceSkuCounts.set(sku, (sourceSkuCounts.get(sku) ?? 0) + 1)
    }
  }

  for (const product of products) {
    if (product.archived) {
      for (const { sku } of sourceEntries(product)) {
        const matches = sku ? matchesBySku.get(sku) ?? [] : []
        if (!sku || matches.length !== 1) {
          skipped.archived += 1
          continue
        }

        items.push({
          action: "archive",
          source: product,
          sku,
          rawKopecks: 0,
          amountRubles: 0,
          categoryPath: [],
          match: matches[0],
        })
      }
      continue
    }

    for (const { variant, sku } of sourceEntries(product)) {
      if (!sku) {
        skipped.missing_code += 1
        continue
      }

      const price = selectSalePrice(product, variant)
      if (!isSelectedPrice(price)) {
        skipped[price.reason] += 1
        productsWithoutPrice.push(productReference(product, sku))
        continue
      }

      if ((sourceSkuCounts.get(sku) ?? 0) > 1) {
        skipped.duplicate_source_sku += 1
        continue
      }

      const matches = matchesBySku.get(sku) ?? []
      if (matches.length > 1) {
        skipped.ambiguous_medusa_sku += 1
        continue
      }

      const match = matches[0]
      const action: ImportAction = match ? "update" : "create"

      items.push({
        action,
        source: product,
        variant,
        sku,
        rawKopecks: price.rawKopecks,
        amountRubles: price.amountRubles,
        categoryPath: parseCategoryPath(product.pathName),
        ...(match ? { match } : {}),
      })

      if (!product.images?.meta?.size) {
        productsWithoutImages.push(productReference(product, sku))
      }
    }
  }

  return {
    items,
    skipped,
    productsWithoutImages,
    productsWithoutPrice,
    priceExamples: items.filter((item) => item.action !== "archive").slice(0, 3).map((item) => ({
      sku: item.sku,
      name: cleanLine(item.source.name),
      rawKopecks: item.rawKopecks,
      amountRubles: item.amountRubles,
    })),
  }
}

function existingCategoryPaths(categories: ExistingCategory[]) {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const memo = new Map<string, string[]>()

  function resolve(category: ExistingCategory, visiting = new Set<string>()): string[] {
    const cached = memo.get(category.id)
    if (cached) {
      return cached
    }

    if (visiting.has(category.id)) {
      return [category.name]
    }

    visiting.add(category.id)
    const parent = category.parentCategoryId
      ? byId.get(category.parentCategoryId)
      : undefined
    const path = parent
      ? [...resolve(parent, visiting), category.name]
      : [category.name]
    visiting.delete(category.id)
    memo.set(category.id, path)
    return path
  }

  return categories.map((category) => ({
    category,
    path: resolve(category),
  }))
}

export function planCatalogCategories(
  productPaths: string[][],
  existingCategories: ExistingCategory[]
): CategoryPlan {
  const categoryIdByPath = new Map<string, string>()
  const usedHandles = new Set(existingCategories.map((category) => category.handle))
  const missing: PlannedCategory[] = []

  for (const { category, path } of existingCategoryPaths(existingCategories)) {
    const key = categoryPathKey(path)
    if (!categoryIdByPath.has(key)) {
      categoryIdByPath.set(key, category.id)
    }
  }

  const everyPath = new Map<string, string[]>()
  for (const productPath of productPaths) {
    for (let depth = 1; depth <= productPath.length; depth += 1) {
      const path = productPath.slice(0, depth)
      everyPath.set(categoryPathKey(path), path)
    }
  }

  const orderedPaths = [...everyPath.values()].sort(
    (left, right) =>
      left.length - right.length ||
      left.join(" / ").localeCompare(right.join(" / "), "ru")
  )

  for (const fullPath of orderedPaths) {
    const key = categoryPathKey(fullPath)
    if (categoryIdByPath.has(key)) {
      continue
    }

    const joinedPath = fullPath.join("-")
    let handle = `moysklad-${toHandle(joinedPath)}`
      .slice(0, 230)
      .replace(/-$/g, "")

    if (usedHandles.has(handle)) {
      handle = `${handle.slice(0, 219)}-${shortHash(categoryPathKey(fullPath))}`
    }

    usedHandles.add(handle)
    const plannedId = `planned:${shortHash(key)}`
    categoryIdByPath.set(key, plannedId)
    missing.push({
      name: fullPath[fullPath.length - 1],
      handle,
      fullPath,
      parentPath: fullPath.length > 1 ? fullPath.slice(0, -1) : null,
    })
  }

  return { missing, categoryIdByPath }
}

function validateMoyskladUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.hostname !== "api.moysklad.ru") {
    throw new Error("МойСклад вернул недопустимую ссылку на ресурс.")
  }
  return url.toString()
}

function retryAfterMilliseconds(value: string | null) {
  if (!value) {
    return MOYSKLAD_RATE_LIMIT.intervalMs
  }

  const milliseconds = Number(value)
  if (Number.isFinite(milliseconds) && milliseconds >= 0) {
    return milliseconds
  }

  const date = Date.parse(value)
  return Number.isFinite(date)
    ? Math.max(0, date - Date.now())
    : MOYSKLAD_RATE_LIMIT.intervalMs
}

async function readErrorBody(response: MoyskladHttpResponse) {
  try {
    return cleanLine(await response.text())
  } catch {
    return ""
  }
}

async function requestMoysklad(options: {
  url: string
  token?: string
  credentials?: MoyskladAuth
  fetch: MoyskladFetch
  throttle: () => Promise<void>
  sleep: (milliseconds: number) => Promise<void>
}) {
  const url = validateMoyskladUrl(options.url)

  for (let attempt = 0; attempt <= MOYSKLAD_MAX_429_RETRIES; attempt += 1) {
    await options.throttle()

    let response: MoyskladHttpResponse
    try {
      response = await options.fetch(url, {
        method: "GET",
        headers: {
          Accept: MOYSKLAD_ACCEPT,
          Authorization: options.credentials?.type === "basic"
            ? `Basic ${Buffer.from(`${options.credentials.login}:${options.credentials.password}`).toString("base64")}`
            : `Bearer ${options.credentials?.token ?? options.token}`,
        },
      })
    } catch {
      throw new Error("Не удалось выполнить запрос к API МойСклад.")
    }

    if (response.status === 429 && attempt < MOYSKLAD_MAX_429_RETRIES) {
      await options.sleep(
        retryAfterMilliseconds(
          response.headers.get("x-lognex-retry-after")
        )
      )
      continue
    }

    if (!response.ok) {
      const detail = await readErrorBody(response)
      throw new Error(
        `API МойСклад вернул HTTP ${response.status}${detail ? `: ${detail}` : "."}`
      )
    }

    return response
  }

  throw new Error("API МойСклад продолжает возвращать HTTP 429.")
}

async function requestMoyskladJson<T>(
  options: Parameters<typeof requestMoysklad>[0]
) {
  const response = await requestMoysklad(options)
  if (!response.json) {
    throw new Error("API МойСклад вернул ответ без JSON.")
  }
  return (await response.json()) as T
}

export async function fetchMoyskladCatalog(options: {
  token?: string
  credentials?: MoyskladCredentials
  fetch?: MoyskladFetch
  throttle?: () => Promise<void>
  sleep?: (milliseconds: number) => Promise<void>
  pageSize?: number
}) {
  const pageSize = options.pageSize ?? MOYSKLAD_CATALOG_PAGE_SIZE
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("Размер страницы каталога МойСклад должен быть от 1 до 1000.")
  }

  const fetch = options.fetch ?? (globalThis.fetch as unknown as MoyskladFetch)
  const throttle =
    options.throttle ?? createMoyskladRateLimiter(MOYSKLAD_RATE_LIMIT)
  const wait = options.sleep ?? sleep
  const products: MoyskladCatalogProduct[] = []
  let offset = 0

  while (true) {
    const result = await requestMoyskladJson<{
      meta?: { size?: number }
      rows?: MoyskladCatalogProduct[]
    }>({
      url: `${MOYSKLAD_API_URL}/entity/product?limit=${pageSize}&offset=${offset}&expand=variants,brand,tags,attributes`,
      token: options.token,
      credentials: options.credentials,
      fetch,
      throttle,
      sleep: wait,
    })
    const rows = result.rows ?? []
    const total = result.meta?.size ?? offset + rows.length

    products.push(...rows)
    offset += rows.length

    if (!rows.length || offset >= total || rows.length < pageSize) {
      return products
    }
  }
}

async function fetchMoyskladImages(options: {
  product: MoyskladCatalogProduct
  token?: string
  credentials?: MoyskladAuth
  fetch: MoyskladFetch
  throttle: () => Promise<void>
  sleep: (milliseconds: number) => Promise<void>
}) {
  const href = options.product.images?.meta?.href
  if (!href) {
    return []
  }

  const url = new URL(validateMoyskladUrl(href))
  url.searchParams.set("limit", "1000")

  const result = await requestMoyskladJson<{ rows?: MoyskladImage[] }>({
    url: url.toString(),
    token: options.token,
    credentials: options.credentials,
    fetch: options.fetch,
    throttle: options.throttle,
    sleep: options.sleep,
  })

  return result.rows ?? []
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

export class MedusaCatalogReader implements CatalogReader {
  private readonly graph: QueryGraph

  constructor(private readonly container: MedusaContainer) {
    this.graph = container.resolve("query") as QueryGraph
  }

  async loadSkuMatches(skus: string[]) {
    const matches = new Map<string, ExistingSkuMatch[]>()

    for (const skuChunk of chunks(skus, 100)) {
      const { data } = await this.graph.graph({
        entity: "product_variant",
        fields: ["id", "sku", "product_id", "metadata"],
        filters: { sku: skuChunk },
        pagination: { take: 1000, skip: 0 },
      })

      for (const row of data) {
        const sku = asString(row.sku)
        const variantId = asString(row.id)
        const productId = asString(row.product_id)
        if (!sku || !variantId || !productId) {
          continue
        }

        const match: ExistingSkuMatch = {
          variantId,
          productId,
          sku,
          metadata: asRecord(row.metadata),
        }
        matches.set(sku, [...(matches.get(sku) ?? []), match])
      }
    }

    return matches
  }

  async loadCategories() {
    const { data } = await this.graph.graph({
      entity: "product_category",
      fields: ["id", "name", "handle", "parent_category_id"],
      pagination: { take: 5000, skip: 0 },
    })

    return data
      .map((row) => ({
        id: asString(row.id),
        name: asString(row.name),
        handle: asString(row.handle),
        parentCategoryId: asString(row.parent_category_id) || null,
      }))
      .filter((category) => category.id && category.name)
  }

  async loadProduct(productId: string) {
    const { data } = await this.graph.graph({
      entity: "product",
      fields: [
        "id",
        "metadata",
        "images.id",
        "images.url",
        "images.metadata",
        "sales_channels.id",
      ],
      filters: { id: productId },
      pagination: { take: 1, skip: 0 },
    })
    const product = data[0]

    if (!product) {
      throw new Error(`Товар Medusa ${productId} не найден.`)
    }

    const images = Array.isArray(product.images) ? product.images : []
    const salesChannels = Array.isArray(product.sales_channels)
      ? product.sales_channels
      : []

    return {
      id: productId,
      metadata: asRecord(product.metadata),
      images: images
        .map((image) => asRecord(image))
        .map((image) => ({
          id: asString(image.id),
          url: asString(image.url),
          metadata: asRecord(image.metadata),
        }))
        .filter((image) => image.id && image.url),
      salesChannelIds: salesChannels
        .map((channel) => asString(asRecord(channel).id))
        .filter(Boolean),
    }
  }

  async loadApplyContext() {
    const [{ data: salesChannels }, { data: shippingProfiles }] =
      await Promise.all([
        this.graph.graph({
          entity: "sales_channel",
          fields: ["id", "name"],
          filters: { name: STOREFRONT_SALES_CHANNEL_NAME },
          pagination: { take: 2, skip: 0 },
        }),
        this.graph.graph({
          entity: "shipping_profile",
          fields: ["id", "name", "type"],
          filters: { type: "default" },
          pagination: { take: 10, skip: 0 },
        }),
      ])

    const salesChannelId = asString(salesChannels[0]?.id)
    const shippingProfileId = asString(shippingProfiles[0]?.id)

    if (!salesChannelId || !shippingProfileId) {
      throw new Error(
        "Не найдены storefront sales channel или default shipping profile. Сначала выполните seed-commerce."
      )
    }

    return { salesChannelId, shippingProfileId }
  }
}

function execPsql(
  sql: string,
  databaseEnvironment: NodeJS.ProcessEnv
) {
  return new Promise<string>((resolve, reject) => {
    const args = [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      `--command=${sql}`,
    ]

    execFile(
      "psql",
      args,
      { env: databaseEnvironment, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `Не удалось выполнить read-only запрос к локальной БД: ${cleanLine(stderr) || error.message}`
            )
          )
          return
        }
        resolve(stdout)
      }
    )
  })
}

function parseJsonLines<T>(stdout: string) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

class DirectDatabaseCatalogReader implements CatalogReader {
  private readonly databaseEnvironment: NodeJS.ProcessEnv

  constructor(databaseUrl: string) {
    const url = new URL(databaseUrl)
    if (!url.hostname || !url.pathname.slice(1) || !url.username) {
      throw new Error("DATABASE_URL задан некорректно.")
    }

    this.databaseEnvironment = {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      ...(url.searchParams.get("sslmode")
        ? { PGSSLMODE: url.searchParams.get("sslmode") as string }
        : {}),
    }
  }

  async loadSkuMatches(skus: string[]) {
    const matches = new Map<string, ExistingSkuMatch[]>()

    for (const skuChunk of chunks(skus, 500)) {
      const skuJsonBase64 = Buffer.from(JSON.stringify(skuChunk)).toString(
        "base64"
      )
      const stdout = await execPsql(
        `SELECT json_build_object(
          'variantId', pv.id,
          'productId', pv.product_id,
          'sku', pv.sku
        )::text
        FROM product_variant pv
        JOIN product p ON p.id = pv.product_id
        WHERE pv.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND pv.sku IN (
            SELECT jsonb_array_elements_text(
              convert_from(decode('${skuJsonBase64}', 'base64'), 'UTF8')::jsonb
            )
          )`,
        this.databaseEnvironment
      )

      for (const match of parseJsonLines<ExistingSkuMatch>(stdout)) {
        matches.set(match.sku, [...(matches.get(match.sku) ?? []), match])
      }
    }

    return matches
  }

  async loadCategories() {
    const stdout = await execPsql(
      `SELECT json_build_object(
        'id', id,
        'name', name,
        'handle', handle,
        'parentCategoryId', parent_category_id
      )::text
      FROM product_category
      WHERE deleted_at IS NULL`,
      this.databaseEnvironment
    )

    return parseJsonLines<ExistingCategory>(stdout)
  }
}

type CoreFlows = typeof import("@medusajs/medusa/core-flows")

async function loadCoreFlows(): Promise<CoreFlows> {
  return import("@medusajs/medusa/core-flows")
}

function safeErrorMessage(error: unknown, token = "") {
  const message = error instanceof Error ? error.message : String(error)
  return cleanLine(token ? message.split(token).join("[REDACTED]") : message)
}

function variantMetadata(item: CatalogImportItem) {
  return {
    ...(item.match?.metadata ?? {}),
    ...(item.variant?.volume ?? item.source.volume
      ? { volume: item.variant?.volume ?? item.source.volume }
      : {}),
    ...(item.source.brand?.name ? { moysklad_brand: item.source.brand.name } : {}),
    ...(item.source.tags?.length
      ? { moysklad_tags: item.source.tags.map((tag) => tag.name).filter(Boolean) }
      : {}),
    ...(item.source.attributes?.length
      ? { moysklad_attributes: item.source.attributes }
      : {}),
    ...(item.variant?.characteristics?.length
      ? { moysklad_characteristics: item.variant.characteristics }
      : {}),
  }
}

function variantCharacteristics(item: CatalogImportItem) {
  return (item.variant?.characteristics ?? [])
    .map((characteristic) => ({
      name: cleanLine(characteristic.name ?? ""),
      value: cleanLine(characteristic.value ?? ""),
    }))
    .filter((characteristic) => characteristic.name && characteristic.value)
}

function productOptionValues(items: CatalogImportItem[]) {
  const values = new Map<string, Set<string>>()
  for (const item of items) {
    for (const characteristic of variantCharacteristics(item)) {
      const existing = values.get(characteristic.name) ?? new Set<string>()
      existing.add(characteristic.value)
      values.set(characteristic.name, existing)
    }
  }
  if (!values.size && items.length > 1) {
    values.set("SKU", new Set(items.map((item) => item.sku)))
  }
  if (!values.size) values.set(DEFAULT_VARIANT_OPTION, new Set([DEFAULT_VARIANT_OPTION]))
  return [...values.entries()].map(([title, optionValues]) => ({
    title,
    values: [...optionValues],
  }))
}

function variantInput(item: CatalogImportItem) {
  const characteristics = variantCharacteristics(item)
  const options = characteristics.length
    ? Object.fromEntries(characteristics.map(({ name, value }) => [name, value]))
    : { [item.variant ? "SKU" : DEFAULT_VARIANT_OPTION]: item.variant ? item.sku : DEFAULT_VARIANT_OPTION }
  const barcode = firstBarcode(item.source, item.variant)
  return {
    title: item.variant?.name?.trim() || item.source.name,
    sku: item.sku,
    manage_inventory: true,
    allow_backorder: false,
    ...(barcode ? { barcode } : {}),
    ...(item.variant?.weight ?? item.source.weight
      ? { weight: item.variant?.weight ?? item.source.weight }
      : {}),
    metadata: variantMetadata(item),
    options,
    prices: [{ amount: item.amountRubles, currency_code: "rub" }],
  }
}

function sourceProductMetadata(item: CatalogImportItem) {
  return {
    moysklad_id: item.source.id,
    ...(item.source.brand?.name ? { moysklad_brand: item.source.brand.name } : {}),
    ...(item.source.tags?.length
      ? { moysklad_tags: item.source.tags.map((tag) => tag.name).filter(Boolean) }
      : {}),
    ...(item.source.attributes?.length
      ? { moysklad_attributes: item.source.attributes }
      : {}),
  }
}

export class MedusaCatalogWriter {
  constructor(
    private readonly container: MedusaContainer,
    private readonly reader: MedusaCatalogReader,
    private readonly flows: CoreFlows,
    private readonly context: ApplyContext,
    private readonly auth: MoyskladAuth,
    private readonly fetch: MoyskladFetch,
    private readonly throttle: () => Promise<void>,
    private readonly wait: (milliseconds: number) => Promise<void>
  ) {}

  async createCategory(category: PlannedCategory, parentCategoryId: string | null) {
    const {
      result: [created],
    } = await this.flows.createProductCategoriesWorkflow(this.container).run({
      input: {
        product_categories: [
          {
            name: category.name,
            handle: category.handle,
            is_active: true,
            is_internal: false,
            parent_category_id: parentCategoryId,
          },
        ],
      },
    })

    return created.id
  }

  async writeProductGroup(items: CatalogImportItem[], categoryId: string | undefined) {
    const item = items[0]
    if (!item) throw new Error("Пустая группа товаров МойСклад.")
    const productIds = new Set(items.filter((entry) => entry.match).map((entry) => entry.match!.productId))
    if (productIds.size > 1 || (productIds.size === 0 && items.some((entry) => entry.action === "update"))) {
      throw new Error(`Варианты товара ${item.source.id} сопоставлены с разными товарами Medusa.`)
    }

    const productId = [...productIds][0]
    const existing = productId ? await this.reader.loadProduct(productId) : undefined
    const salesChannelIds = [...new Set([...(existing?.salesChannelIds ?? []), this.context.salesChannelId])]
    const action = item.action === "archive"
      ? "archive"
      : productId
        ? "update"
        : "create"
    const input: ApplyMoyskladCatalogProductInput = {
      action,
      product: {
        ...(productId ? { id: productId } : {}),
        title: item.source.name,
        handle: productHandle(item.source, item.sku),
        description: item.source.description ?? null,
        external_id: item.source.id,
        status: "published",
        category_ids: categoryId ? [categoryId] : [],
        shipping_profile_id: this.context.shippingProfileId,
        metadata: sourceProductMetadata(item),
        sales_channels: salesChannelIds.map((id) => ({ id })),
      },
      options: productOptionValues(items),
      variants: action === "archive"
        ? []
        : items.map((entry) => ({
            ...(entry.match ? { id: entry.match.variantId } : {}),
            ...variantInput(entry),
          })),
      ...(existing && productId
        ? {
            existing: {
              id: productId,
              metadata: existing.metadata,
              salesChannelIds: existing.salesChannelIds,
            },
          }
        : {}),
    }

    const { result } = await applyMoyskladCatalogProductWorkflow(this.container).run({
      input,
    })
    return result as string
  }

  async syncImages(item: CatalogImportItem, productId: string) {
    const failures: string[] = []
    let sourceImages: MoyskladImage[]

    try {
      sourceImages = await fetchMoyskladImages({
        product: item.source,
        credentials: this.auth,
        fetch: this.fetch,
        throttle: this.throttle,
        sleep: this.wait,
      })
    } catch (error) {
      return [
        `${item.sku}: список изображений — ${safeErrorMessage(error, this.auth.type === "token" ? this.auth.token : this.auth.password)}`,
      ]
    }

    if (!sourceImages.length) {
      return [`${item.sku}: API сообщил о картинках, но не вернул их список.`]
    }

    const existing = await this.reader.loadProduct(productId)
    const existingByMoyskladHref = new Map(
      existing.images
        .map((image) => [asString(image.metadata?.moysklad_href), image] as const)
        .filter(([href]) => href)
    )
    const newImages: ExistingProduct["images"] = []
    const sourceImageUrls: string[] = []

    for (const [index, sourceImage] of sourceImages.entries()) {
      const existingImage = existingByMoyskladHref.get(sourceImage.meta.href)
      if (existingImage) {
        sourceImageUrls.push(existingImage.url)
        continue
      }

      const downloadHref = sourceImage.meta.downloadHref
      if (!downloadHref) {
        failures.push(`${item.sku}: у изображения ${index + 1} нет downloadHref.`)
        continue
      }

      try {
        const response = await requestMoysklad({
          url: downloadHref,
          credentials: this.auth,
          fetch: this.fetch,
          throttle: this.throttle,
          sleep: this.wait,
        })
        if (!response.arrayBuffer) {
          throw new Error("ответ не содержит бинарный файл")
        }

        const content = Buffer.from(await response.arrayBuffer()).toString("base64")
        const mimeType = response.headers.get("content-type")?.split(";")[0]
          || "image/jpeg"
        const filename = cleanLine(sourceImage.filename || `${item.sku}-${index + 1}.jpg`)
          .replace(/[\\/]/g, "-")
        const {
          result: [file],
        } = await this.flows.uploadFilesWorkflow(this.container).run({
          input: {
            files: [
              {
                filename,
                mimeType,
                content,
                access: "public",
              },
            ],
          },
        })

        if (!file?.url) {
          throw new Error("file-сервис не вернул URL")
        }

        sourceImageUrls.push(file.url)
        newImages.push({
          id: "",
          url: file.url,
          metadata: { moysklad_href: sourceImage.meta.href },
        })
      } catch (error) {
        failures.push(
          `${item.sku}: изображение ${index + 1} — ${safeErrorMessage(error, this.auth.type === "token" ? this.auth.token : this.auth.password)}`
        )
      }
    }

    if (!sourceImageUrls.length) {
      return failures
    }

    try {
      await this.flows.updateProductsWorkflow(this.container).run({
        input: {
          selector: { id: productId },
          update: {
            images: [
              ...existing.images.map((image) => ({
                id: image.id,
                url: image.url,
                metadata: image.metadata ?? undefined,
              })),
              ...newImages.map((image) => ({
                url: image.url,
                metadata: image.metadata ?? undefined,
              })),
            ],
            thumbnail: sourceImageUrls[0],
          },
        },
      })
    } catch (error) {
      failures.push(
        `${item.sku}: привязка изображений — ${safeErrorMessage(error, this.auth.type === "token" ? this.auth.token : this.auth.password)}`
      )
    }

    return failures
  }
}

function reportList(logger: Logger, title: string, values: string[]) {
  logger.info(`${title}: ${values.length}`)
  for (const value of values) {
    logger.info(`  - ${cleanLine(value)}`)
  }
}

function emitReport(logger: Logger, report: CatalogImportReport) {
  logger.info("=== Импорт каталога МойСклад → Medusa ===")
  logger.info(`Режим: ${report.mode === "apply" ? "ЗАПИСЬ" : "ПРОВЕРКА БЕЗ ЗАПИСИ"}`)
  logger.info(`Получено товаров из МойСклад: ${report.sourceTotal}`)
  logger.info(
    `${report.mode === "apply" ? "Создано" : "Будет создано"}: ${report.created}`
  )
  logger.info(
    `${report.mode === "apply" ? "Обновлено" : "Будет обновлено"}: ${report.updated}`
  )
  logger.info(
    `Пропущено: ${Object.values(report.skipped).reduce((sum, value) => sum + value, 0)}`
  )

  for (const [reason, count] of Object.entries(report.skipped)) {
    logger.info(`  - ${reason}: ${count}`)
  }

  reportList(
    logger,
    report.mode === "apply" ? "Созданные категории" : "Будут созданы категории",
    report.categories
  )
  reportList(logger, "Товары без картинок", report.productsWithoutImages)
  reportList(logger, "Товары без цены «Цена продажи»", report.productsWithoutPrice)
  reportList(logger, "Ошибки изображений", report.imageFailures)
  reportList(logger, "Ошибки обработки товаров", report.processingErrors)

  logger.info(`Примеры расчёта цены: ${report.priceExamples.length}`)
  for (const example of report.priceExamples) {
    logger.info(
      `  - ${example.sku} — ${example.name}: ${example.rawKopecks} коп. / 100 = ${example.amountRubles} RUB в Medusa`
    )
  }
}

export async function runCatalogImport(
  options: RunImportOptions
): Promise<CatalogImportReport> {
  const auth: MoyskladAuth = options.credentials ?? {
    type: "token",
    token: options.token ?? "",
  }
  const fetch = options.fetch ?? (globalThis.fetch as unknown as MoyskladFetch)
  const wait = options.sleep ?? sleep
  const throttle =
    options.throttle ?? createMoyskladRateLimiter(MOYSKLAD_RATE_LIMIT)
  const products = await fetchMoyskladCatalog({
    credentials: auth,
    fetch,
    throttle,
    sleep: wait,
  })
  const skus = [
    ...new Set(
      products
        .flatMap((product) => sourceEntries(product).map(({ sku }) => sku))
        .filter((sku): sku is string => Boolean(sku))
    ),
  ]
  const [matches, existingCategories] = await Promise.all([
    options.reader.loadSkuMatches(skus),
    options.reader.loadCategories(),
  ])
  const plan = buildCatalogImportPlan(products, matches)
  const categoryPlan = planCatalogCategories(
    plan.items.map((item) => item.categoryPath),
    existingCategories
  )

  if (!options.apply) {
    return {
      mode: "dry-run",
      sourceTotal: products.length,
      created: plan.items.filter((item) => item.action === "create").length,
      updated: plan.items.filter((item) => item.action !== "create").length,
      skipped: plan.skipped,
      categories: categoryPlan.missing.map((category) =>
        category.fullPath.join(" / ")
      ),
      productsWithoutImages: plan.productsWithoutImages,
      productsWithoutPrice: plan.productsWithoutPrice,
      imageFailures: [],
      processingErrors: [],
      priceExamples: plan.priceExamples,
    }
  }

  if (!options.writer) {
    throw new Error("Режим --apply доступен только через medusa exec.")
  }

  const categoryIdByPath = new Map(categoryPlan.categoryIdByPath)
  const createdCategories: string[] = []
  for (const category of categoryPlan.missing) {
    const parentCategoryId = category.parentPath
      ? categoryIdByPath.get(categoryPathKey(category.parentPath))
      : null

    if (category.parentPath && !parentCategoryId) {
      throw new Error(
        `Не найдена родительская категория ${category.parentPath.join(" / ")}.`
      )
    }

    const categoryId = await options.writer.createCategory(
      category,
      parentCategoryId ?? null
    )
    categoryIdByPath.set(categoryPathKey(category.fullPath), categoryId)
    createdCategories.push(category.fullPath.join(" / "))
  }

  let created = 0
  let updated = 0
  const skipped = { ...plan.skipped }
  const imageFailures: string[] = []
  const processingErrors: string[] = []

  const groups = new Map<string, CatalogImportItem[]>()
  for (const item of plan.items) {
    groups.set(item.source.id, [...(groups.get(item.source.id) ?? []), item])
  }

  for (const [index, items] of [...groups.values()].entries()) {
    const item = items[0]
    if (!item) continue
    try {
      const categoryId = item.categoryPath.length
        ? categoryIdByPath.get(categoryPathKey(item.categoryPath))
        : undefined
      const productId = await options.writer.writeProductGroup(items, categoryId)

      created += items.filter((entry) => entry.action === "create").length
      updated += items.filter((entry) => entry.action !== "create").length

      if (item.action !== "archive" && item.source.images?.meta?.size) {
        imageFailures.push(...(await options.writer.syncImages(item, productId)))
      }
    } catch (error) {
      skipped.processing_error += 1
      processingErrors.push(
        `${item.sku}: ${safeErrorMessage(error, auth.type === "token" ? auth.token : auth.password)}`
      )
    }

    if ((index + 1) % 100 === 0) {
      options.logger.info(`Обработано ${index + 1} из ${groups.size} товаров.`)
    }
  }

  return {
    mode: "apply",
    sourceTotal: products.length,
    created,
    updated,
    skipped,
    categories: createdCategories,
    productsWithoutImages: plan.productsWithoutImages,
    productsWithoutPrice: plan.productsWithoutPrice,
    imageFailures,
    processingErrors,
    priceExamples: plan.priceExamples,
  }
}

export default async function importMoyskladCatalog({ container }: ExecArgs) {
  const { token } = readMoyskladEnvironment(process.env)
  const logger = container.resolve("logger") as Logger
  const apply = process.argv.includes("--apply")
  const reader = new MedusaCatalogReader(container)
  const throttle = createMoyskladRateLimiter(MOYSKLAD_RATE_LIMIT)
  let writer: MedusaCatalogWriter | undefined

  if (apply) {
    const context = await reader.loadApplyContext()
    writer = new MedusaCatalogWriter(
      container,
      reader,
      await loadCoreFlows(),
      context,
      { type: "token", token },
      globalThis.fetch as unknown as MoyskladFetch,
      throttle,
      sleep
    )
  }

  const report = await runCatalogImport({
    apply,
    token,
    reader,
    writer,
    logger,
    throttle,
  })
  emitReport(logger, report)
}

export async function runDirectDryRun() {
  if (process.argv.includes("--apply")) {
    throw new Error("Режим --apply доступен только через medusa exec.")
  }

  const { token } = readMoyskladEnvironment(process.env)
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.trim()) {
    throw new Error("Для прямого dry-run необходимо задать DATABASE_URL.")
  }

  const logger: Logger = { info: (message) => console.log(message) }
  const report = await runCatalogImport({
    apply: false,
    token,
    reader: new DirectDatabaseCatalogReader(databaseUrl),
    logger,
  })
  emitReport(logger, report)
}

if (typeof require !== "undefined" && require.main === module) {
  runDirectDryRun().catch((error) => {
    const token = process.env.MOYSKLAD_TOKEN ?? ""
    console.error(safeErrorMessage(error, token))
    process.exitCode = 1
  })
}
