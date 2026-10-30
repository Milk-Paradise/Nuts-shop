import {
  availabilityRank,
  type AvailabilityStatus,
} from "../../utils/availability"
import { mapCatalogProduct } from "../../api/catalog/utils"

export type CatalogIndexDocument = {
  id: string
  title: string
  description: string | null
  variant_id: string | null
  article: string | null
  articles: string[]
  category: string
  categories: string[]
  category_ids: string[]
  brand: string | null
  price: number
  availability: AvailabilityStatus
  max_quantity: number | null
  availability_rank: number
  image_url: string | null
  search_keywords: string[]
}

type IndexSourceCategory = {
  id?: string | null
  name?: string | null
}

type IndexSourceProduct = {
  categories?: IndexSourceCategory[] | null
  variants?: { sku?: string | null }[] | null
} & Parameters<typeof mapCatalogProduct>[0]

export type CategoryPathResolver = ((categoryId: string) => string[]) & {
  idsFor: (categoryId: string) => string[]
}

type RawCategory = {
  id?: string | null
  name?: string | null
  parent_category_id?: string | null
  is_active?: boolean
  is_internal?: boolean
}

export function createCategoryPathResolver(
  categories: RawCategory[]
): CategoryPathResolver {
  const byId = new Map(
    categories
      .filter((category): category is RawCategory & { id: string } => !!category.id)
      .map((category) => [category.id, category])
  )

  function publicPath(categoryId: string): RawCategory[] {
    const path: RawCategory[] = []
    const visited = new Set<string>()
    let current = byId.get(categoryId)

    while (current && current.id) {
      if (
        visited.has(current.id) ||
        current.is_active === false ||
        current.is_internal === true
      ) {
        return []
      }
      visited.add(current.id)
      path.unshift(current)

      if (!current.parent_category_id) {
        return path
      }

      current = byId.get(current.parent_category_id)
    }

    return []
  }

  const resolve = ((categoryId: string) =>
    publicPath(categoryId)
      .map((category) => category.name?.trim())
      .filter((name): name is string => !!name)) as CategoryPathResolver

  resolve.idsFor = (categoryId) =>
    publicPath(categoryId)
      .map((category) => category.id)
      .filter((id): id is string => !!id)

  return resolve
}

function unique(values: string[]) {
  return Array.from(new Set(values))
}

function searchKeywords(product: IndexSourceProduct) {
  const value = product.metadata?.search_keywords

  if (!Array.isArray(value)) {
    return []
  }

  return unique(
    value.flatMap((keyword) => {
      if (typeof keyword !== "string") {
        return []
      }

      const normalized = keyword.trim()
      return normalized ? [normalized] : []
    }),
  )
}

export function buildCatalogIndexDocument(
  product: IndexSourceProduct,
  resolveCategoryPath: CategoryPathResolver
): CatalogIndexDocument | null {
  const mapped = mapCatalogProduct(product, { includeDetails: true })

  if (!mapped) {
    return null
  }

  const articles = unique(
    (product.variants ?? [])
      .map((variant) => variant.sku?.trim())
      .filter((sku): sku is string => !!sku)
  )

  const categories = unique(
    (product.categories ?? []).flatMap((category) => {
      if (!category.id) {
        const name = category.name?.trim()
        return name ? [name] : []
      }

      return resolveCategoryPath(category.id)
    })
  )
  const categoryIds = unique(
    (product.categories ?? []).flatMap((category) =>
      category.id ? resolveCategoryPath.idsFor(category.id) : []
    )
  )
  const category =
    (product.categories ?? [])
      .map((sourceCategory) =>
        sourceCategory.id
          ? resolveCategoryPath(sourceCategory.id).at(-1)
          : sourceCategory.name?.trim()
      )
      .find((name): name is string => !!name) ?? ""

  return {
    id: mapped.id,
    title: mapped.title,
    description: mapped.description ?? null,
    variant_id: mapped.variant_id,
    article: mapped.article,
    articles,
    category,
    categories,
    category_ids: categoryIds,
    brand: mapped.brand ?? null,
    price: mapped.price,
    availability: mapped.availability,
    max_quantity: mapped.max_quantity ?? null,
    availability_rank: availabilityRank[mapped.availability],
    image_url: mapped.image_url ?? null,
    search_keywords: searchKeywords(product),
  }
}
