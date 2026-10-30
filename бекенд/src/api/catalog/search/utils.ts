import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import { MEILISEARCH_MODULE } from "../../../modules/meilisearch"
import type { CatalogSearchDocument } from "../../../modules/meilisearch/service"
import type MeilisearchModuleService from "../../../modules/meilisearch/service"
import type { AvailabilityStatus } from "../../../utils/availability"
import type { CatalogProduct } from "../utils"
import type { CatalogSort, GetCatalogSearchQuery } from "../validators"
import {
  findPublicCategoryById,
  findPublicCategoriesByName,
} from "../../../lib/public-category"

// Имена атрибутов индекса, а не витрины: они объявлены в filterableAttributes
// модуля Meilisearch, без этого распределение по фасетам не считается.
const CATALOG_FACETS = ["categories", "brand", "availability"]

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

export type NormalizedCatalogSearchQuery = {
  q?: string
  category?: string
  category_id?: string
  category_ids?: string[]
  brand?: string
  availability?: AvailabilityStatus
  min_price?: number
  max_price?: number
  page: number
  limit: number
  sort: CatalogSort
}

export type CatalogSearchFacets = {
  category: Record<string, number>
  brand: Record<string, number>
  availability: Record<string, number>
}

export type CatalogSearchResponseBody = {
  products: CatalogProduct[]
  total: number
  page: number
  limit: number
  pages: number
  query: string
  filters: Omit<NormalizedCatalogSearchQuery, "page" | "limit" | "q" | "sort">
  sort: CatalogSort
  // Счётчики считаются Meilisearch по всей найденной выдаче с учётом уже
  // применённых фильтров, а не по текущей странице.
  facets: CatalogSearchFacets
  processing_time_ms: number
}

function meilisearch(container: MedusaContainer) {
  return container.resolve<MeilisearchModuleService>(MEILISEARCH_MODULE)
}

function positiveInteger(value: number | undefined, fallback: number) {
  return value && Number.isInteger(value) && value > 0 ? value : fallback
}

function clampLimit(value: number | undefined) {
  return Math.min(positiveInteger(value, DEFAULT_LIMIT), MAX_LIMIT)
}

export function normalizeCatalogSearchQuery(
  query: GetCatalogSearchQuery
): NormalizedCatalogSearchQuery {
  let minPrice = query.min_price
  let maxPrice = query.max_price

  if (
    minPrice !== undefined &&
    maxPrice !== undefined &&
    minPrice > maxPrice
  ) {
    const lowerPrice = maxPrice
    maxPrice = minPrice
    minPrice = lowerPrice
  }

  return {
    q: query.q,
    category: query.category,
    category_id: query.category_id,
    brand: query.brand,
    availability: query.availability,
    min_price: minPrice,
    max_price: maxPrice,
    sort: query.sort ?? "relevance",
    page: positiveInteger(query.page, DEFAULT_PAGE),
    limit: clampLimit(query.limit),
  }
}

function meiliString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function equalFilter(attribute: string, value: string) {
  return `${attribute} = ${meiliString(value)}`
}

export function buildCatalogSearchFilters(
  query: NormalizedCatalogSearchQuery
) {
  const filters: string[] = []

  if (query.category_ids?.length) {
    filters.push(
      `(${query.category_ids.map((id) => equalFilter("category_ids", id)).join(" OR ")})`
    )
  } else if (query.category) {
    filters.push(equalFilter("categories", query.category))
  }

  if (query.brand) {
    filters.push(equalFilter("brand", query.brand))
  }

  if (query.availability) {
    filters.push(equalFilter("availability", query.availability))
  }

  if (query.min_price !== undefined) {
    filters.push(`price >= ${query.min_price}`)
  }

  if (query.max_price !== undefined) {
    filters.push(`price <= ${query.max_price}`)
  }

  return filters
}

export function buildCatalogSearchSort(query: NormalizedCatalogSearchQuery) {
  // Недоступные товары не всплывают выше доступных ни при какой сортировке,
  // поэтому availability_rank остаётся первичным ключом.
  const base = ["availability_rank:asc"]

  switch (query.sort) {
    case "price_asc":
      return [...base, "price:asc"]
    case "price_desc":
      return [...base, "price:desc"]
    case "title":
      return [...base, "title:asc"]
    default:
      // При поисковом запросе дальше решает релевантность Meilisearch,
      // без запроса стабильный порядок даёт сортировка по названию.
      return query.q ? base : [...base, "title:asc"]
  }
}

function mapCatalogSearchDocument(
  document: CatalogSearchDocument
): CatalogProduct {
  const articles = document.articles.filter((article) => article.trim())

  return {
    id: document.id,
    title: document.title,
    variant_id: document.variant_id ?? null,
    article: articles.length === 1 ? articles[0] : null,
    price: document.price,
    availability: document.availability,
    max_quantity: document.max_quantity,
    category: document.category,
    brand: document.brand,
    image_url: document.image_url,
  }
}

export async function searchCatalogProducts(
  container: MedusaContainer,
  query: GetCatalogSearchQuery
): Promise<CatalogSearchResponseBody> {
  const service = meilisearch(container)
  const normalized = normalizeCatalogSearchQuery(query)

  if (normalized.category_id) {
    const category = await findPublicCategoryById(
      container,
      normalized.category_id
    )
    if (!category) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Product category with id "${normalized.category_id}" was not found`
      )
    }
    normalized.category = category.name
    normalized.category_ids = [category.id]
  } else if (normalized.category) {
    const categories = await findPublicCategoriesByName(
      container,
      normalized.category
    )
    if (!categories.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Product category with name "${normalized.category}" was not found`
      )
    }
    normalized.category_ids = categories.map((category) => category.id)
    normalized.category = categories[0].name
  }

  const result = await service.searchCatalogDocuments({
    query: normalized.q ?? "",
    filter: buildCatalogSearchFilters(normalized),
    sort: buildCatalogSearchSort(normalized),
    page: normalized.page,
    hitsPerPage: normalized.limit,
    facets: CATALOG_FACETS,
  })

  return {
    products: result.hits.map(mapCatalogSearchDocument),
    total: result.totalHits,
    page: result.page,
    limit: result.hitsPerPage,
    pages: result.totalPages,
    query: result.query,
    sort: normalized.sort,
    facets: {
      category: result.facetDistribution?.categories ?? {},
      brand: result.facetDistribution?.brand ?? {},
      availability: result.facetDistribution?.availability ?? {},
    },
    filters: {
      category: normalized.category,
      brand: normalized.brand,
      availability: normalized.availability,
      min_price: normalized.min_price,
      max_price: normalized.max_price,
    },
    processing_time_ms: result.processingTimeMs,
  }
}
