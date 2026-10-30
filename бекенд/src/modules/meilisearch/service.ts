import { MedusaError } from "@medusajs/framework/utils"
import { randomUUID } from "node:crypto"

import type { CatalogIndexDocument } from "./documents"

export type MeilisearchModuleOptions = {
  host?: string
  apiKey?: string
  indexPrefix?: string
}

export const CATALOG_INDEX = "products"

const catalogSearchAttributes = [
  "id",
  "title",
  "variant_id",
  "article",
  "articles",
  "category",
  "brand",
  "price",
  "availability",
  "availability_rank",
  "image_url",
]

export const catalogIndexSettings = {
  searchableAttributes: ["search_keywords", "title", "articles"],
  filterableAttributes: [
    "categories",
    "category_ids",
    "brand",
    "price",
    "availability",
  ],
  sortableAttributes: ["availability_rank", "title", "price"],
  rankingRules: ["sort", "words", "typo", "proximity", "attribute", "exactness"],
  faceting: { maxValuesPerFacet: 10_000 },
}

export type CatalogSearchDocumentsOptions = {
  query?: string
  filter?: string[]
  sort?: string[]
  page: number
  hitsPerPage: number
  facets?: string[]
}

export type CatalogSearchDocument = Pick<
  CatalogIndexDocument,
  | "id"
  | "title"
  | "variant_id"
  | "article"
  | "articles"
  | "category"
  | "brand"
  | "price"
  | "availability"
  | "max_quantity"
  | "availability_rank"
  | "image_url"
>

export type CatalogSearchDocumentsResult = {
  hits: CatalogSearchDocument[]
  totalHits: number
  page: number
  hitsPerPage: number
  totalPages: number
  processingTimeMs: number
  query: string
  facetDistribution?: Record<string, Record<string, number>>
}

type MeilisearchTask = {
  waitTask(): Promise<unknown>
}

type MeilisearchSearchResponse = {
  hits: CatalogSearchDocument[]
  totalHits?: number
  estimatedTotalHits?: number
  page?: number
  hitsPerPage?: number
  totalPages?: number
  processingTimeMs: number
  query: string
  facetDistribution?: Record<string, Record<string, number>>
}

type MeilisearchCatalogIndex = {
  updateSettings(settings: typeof catalogIndexSettings): MeilisearchTask
  search(
    query: string,
    options: {
      filter?: string[]
      sort?: string[]
      page?: number
      hitsPerPage?: number
      attributesToRetrieve?: string[]
      facets?: string[]
    }
  ): Promise<MeilisearchSearchResponse>
  addDocuments(documents: CatalogIndexDocument[]): MeilisearchTask
  deleteDocuments(ids: string[]): MeilisearchTask
  getStats(): Promise<{ numberOfDocuments: number }>
}

type MeilisearchClient = {
  getIndex(uid: string): Promise<unknown>
  createIndex(uid: string, options: { primaryKey: string }): MeilisearchTask
  deleteIndex(uid: string): MeilisearchTask
  index(uid: string): MeilisearchCatalogIndex
  swapIndexes(swaps: { indexes: [string, string] }[]): MeilisearchTask
}

export function errorCode(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined

  const direct = (error as { code?: unknown }).code
  if (direct !== undefined) return direct

  return (error as { cause?: { code?: unknown } }).cause?.code
}

function isMeilisearchErrorCode(error: unknown, code: string) {
  return errorCode(error) === code
}

const TASK_TIMEOUT_MS = 120_000

export default class MeilisearchModuleService {
  protected client_?: MeilisearchClient
  protected options_: Required<Pick<MeilisearchModuleOptions, "host">> &
    Pick<MeilisearchModuleOptions, "apiKey" | "indexPrefix">
  protected resetCatalogIndexQueue_: Promise<void> = Promise.resolve()

  constructor(_: unknown, options?: MeilisearchModuleOptions) {
    if (!options?.host) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "Meilisearch module requires the `host` option (MEILISEARCH_HOST)."
      )
    }

    this.options_ = {
      host: options.host,
      apiKey: options.apiKey,
      indexPrefix: options.indexPrefix,
    }
  }

  protected catalogIndex() {
    return `${this.options_.indexPrefix ?? ""}${CATALOG_INDEX}`
  }

  protected async client() {
    if (!this.client_) {
      const { Meilisearch } = await import("meilisearch")

      // Клиент по умолчанию ждёт задачу индексации всего 5 секунд и бросает
      // MeilisearchTaskTimeOutError. Полная переиндексация каталога в это не
      // укладывается — падало и на подготовке e2e-прогона, и упадёт на живом
      // каталоге любого заметного размера.
      this.client_ = new Meilisearch({
        ...this.options_,
        defaultWaitOptions: { timeout: TASK_TIMEOUT_MS },
      }) as MeilisearchClient
    }

    return this.client_
  }

  async configureCatalogIndex() {
    const client = await this.client()

    try {
      await client.getIndex(this.catalogIndex())
    } catch (error) {
      if (!isMeilisearchErrorCode(error, "index_not_found")) {
        throw error
      }

      await client.createIndex(this.catalogIndex(), { primaryKey: "id" }).waitTask()
    }

    await client
      .index(this.catalogIndex())
      .updateSettings(catalogIndexSettings)
      .waitTask()
  }

  async upsertCatalogDocuments(documents: CatalogIndexDocument[]) {
    if (!documents.length) {
      return
    }

    const client = await this.client()

    await client.index(this.catalogIndex()).addDocuments(documents).waitTask()
  }

  async deleteCatalogDocuments(ids: string[]) {
    if (!ids.length) {
      return
    }

    const client = await this.client()

    await client.index(this.catalogIndex()).deleteDocuments(ids).waitTask()
  }

  async searchCatalogDocuments(
    options: CatalogSearchDocumentsOptions
  ): Promise<CatalogSearchDocumentsResult> {
    const client = await this.client()

    const runSearch = () =>
      client.index(this.catalogIndex()).search(options.query ?? "", {
        filter: options.filter?.length ? options.filter : undefined,
        sort: options.sort?.length ? options.sort : undefined,
        page: options.page,
        hitsPerPage: options.hitsPerPage,
        attributesToRetrieve: catalogSearchAttributes,
        facets: options.facets?.length ? options.facets : undefined,
      })

    let result: MeilisearchSearchResponse
    try {
      try {
        result = await runSearch()
      } catch (error) {
        // Настройки индекса применяются при синхронизации товаров, поэтому на
        // уже развёрнутом магазине новое сортируемое или фильтруемое поле
        // появляется в коде раньше, чем в самом Meilisearch. Применяем
        // настройки и повторяем запрос вместо ошибки поиска.
        if (
          !isMeilisearchErrorCode(error, "invalid_search_sort") &&
          !isMeilisearchErrorCode(error, "invalid_search_facets") &&
          !isMeilisearchErrorCode(error, "invalid_search_filter")
        ) {
          throw error
        }

        await this.configureCatalogIndex()
        result = await runSearch()
      }
    } catch (error) {
      // A fresh store has no synced products yet, so the index doesn't exist
      // until the first product event runs `resetCatalogIndex`/`upsertCatalogDocuments`.
      // Treat that as an empty catalog rather than a search outage.
      if (!isMeilisearchErrorCode(error, "index_not_found")) {
        throw error
      }

      return {
        hits: [],
        totalHits: 0,
        page: options.page,
        hitsPerPage: options.hitsPerPage,
        totalPages: 0,
        processingTimeMs: 0,
        query: options.query ?? "",
      }
    }

    return {
      hits: result.hits,
      totalHits: result.totalHits ?? result.estimatedTotalHits ?? result.hits.length,
      page: result.page ?? options.page,
      hitsPerPage: result.hitsPerPage ?? options.hitsPerPage,
      totalPages:
        result.totalPages ??
        Math.ceil(
          (result.totalHits ?? result.estimatedTotalHits ?? result.hits.length) /
            options.hitsPerPage
        ),
      processingTimeMs: result.processingTimeMs,
      query: result.query,
      facetDistribution: result.facetDistribution,
    }
  }

  async hasCatalogDocumentsMatching(filter: string) {
    const client = await this.client()

    try {
      const result = await client.index(this.catalogIndex()).search("", {
        filter: [filter],
        page: 1,
        hitsPerPage: 1,
        attributesToRetrieve: ["id"],
      })

      return (result.totalHits ?? result.estimatedTotalHits ?? 0) > 0
    } catch (error) {
      if (!isMeilisearchErrorCode(error, "index_not_found")) {
        throw error
      }

      return false
    }
  }

  async listCatalogBrands() {
    const client = await this.client()
    try {
      const result = await client.index(this.catalogIndex()).search("", {
        page: 1,
        hitsPerPage: 1,
        attributesToRetrieve: ["id"],
        facets: ["brand"],
      })
      return brandNamesFromFacet(result.facetDistribution?.brand)
    } catch (error) {
      if (!isMeilisearchErrorCode(error, "index_not_found")) throw error
      return []
    }
  }

  async resetCatalogIndex(documents: CatalogIndexDocument[]) {
    // Полная переиндексация собирается во временном индексе и подменяется
    // одной атомарной swapIndexes — рабочий индекс никогда не пустеет между
    // удалением и повторной заливкой документов (было именно так и витрина
    // отдавала пустой каталог/поиск на каждом заказе, см. #34).
    // Очередь (resetCatalogIndexQueue_) сериализует конкурентные вызовы: два
    // параллельных полных ресинка не должны создавать гонку за один и тот же
    // временный индекс.
    const reset = this.resetCatalogIndexQueue_.then(async () => {
      const client = await this.client()
      const primaryIndex = this.catalogIndex()
      const temporaryIndex = `${primaryIndex}_reindex_${randomUUID()}`

      await this.configureCatalogIndex()

      let resetError: unknown

      try {
        await client
          .createIndex(temporaryIndex, { primaryKey: "id" })
          .waitTask()
        await client
          .index(temporaryIndex)
          .updateSettings(catalogIndexSettings)
          .waitTask()

        if (documents.length) {
          await client.index(temporaryIndex).addDocuments(documents).waitTask()
        }

        await client
          .swapIndexes([{ indexes: [primaryIndex, temporaryIndex] }])
          .waitTask()
      } catch (error) {
        resetError = error
        throw error
      } finally {
        try {
          await client.deleteIndex(temporaryIndex).waitTask()
        } catch (error) {
          if (!resetError && !isMeilisearchErrorCode(error, "index_not_found")) {
            throw error
          }
        }
      }
    })

    this.resetCatalogIndexQueue_ = reset.catch(() => undefined)

    return reset
  }

  async countCatalogDocuments() {
    const client = await this.client()
    const stats = await client.index(this.catalogIndex()).getStats()

    return stats.numberOfDocuments
  }
}

export function brandNamesFromFacet(facet?: Record<string, number>) {
  const normalized = new Map<string, string>()
  for (const rawBrand of Object.keys(facet ?? {})) {
    const brand = rawBrand.trim()
    if (brand && !normalized.has(brand.toLocaleLowerCase("ru"))) {
      normalized.set(brand.toLocaleLowerCase("ru"), brand)
    }
  }
  return [...normalized.values()]
    .sort((left, right) => left.localeCompare(right, "ru", { sensitivity: "base" }))
}
