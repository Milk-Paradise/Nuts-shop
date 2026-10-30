import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"

import {
  catalogProductFields,
  mapCatalogProduct,
  sortCatalogProducts,
  type CatalogProduct,
  type CatalogSourceProduct,
} from "../../../utils"
import { findPublicCategoryById } from "../../../../../lib/public-category"

const CATEGORY_PRODUCTS_LIMIT = 24
const PRODUCT_QUERY_BATCH_SIZE = 250

type ProductCategoryTree = {
  id?: string
  name?: string
  handle?: string
  parent_category_id?: string | null
  is_active?: boolean
  is_internal?: boolean
  category_children?: ProductCategoryTree[] | null
}

export type CategoryProductsResponse = {
  category: {
    id: string
    name: string
    handle: string
  }
  products: CatalogProduct[]
  total: number
  page: number
  limit: number
  pages: number
}

function categoryIds(root: ProductCategoryTree) {
  const ids: string[] = []
  const visited = new Set<string>()
  const pending = [root]

  while (pending.length) {
    const category = pending.pop()
    const id = category?.id

    if (!id || visited.has(id) || !isPublicCategory(category)) {
      continue
    }

    visited.add(id)
    ids.push(id)
    pending.push(...(category.category_children ?? []).slice().reverse())
  }

  return ids
}

function isPublicCategory(category: ProductCategoryTree | undefined) {
  return !!category && category.is_active !== false && category.is_internal !== true
}

function categoryNotFound(handle: string): never {
  throw new MedusaError(
    MedusaError.Types.NOT_FOUND,
    `Product category with handle "${handle}" was not found`
  )
}

function categoryByHandle(
  root: ProductCategoryTree,
  handle: string,
  publicOnly = false
) {
  const visited = new Set<string>()
  const pending = [root]

  while (pending.length) {
    const category = pending.pop()
    const id = category?.id

    if (!category || !id || visited.has(id)) {
      continue
    }

    visited.add(id)

    if (publicOnly && !isPublicCategory(category)) {
      continue
    }

    if (category.handle === handle) {
      return category
    }

    pending.push(...(category.category_children ?? []))
  }

  return undefined
}

async function publicCategoryTree(container: MedusaContainer, handle: string) {
  const productModuleService = container.resolve(Modules.PRODUCT)
  const categories = (await productModuleService.listProductCategories(
    {
      handle,
      include_descendants_tree: true,
      is_active: true,
      is_internal: false,
    },
    {
      select: [
        "id",
        "name",
        "handle",
        "parent_category_id",
        "rank",
        "is_active",
        "is_internal",
      ],
    }
  )) as ProductCategoryTree[]

  const category = categories[0]

  if (
    !category?.id ||
    !category.name ||
    !category.handle ||
    !isPublicCategory(category)
  ) {
    categoryNotFound(handle)
  }

  if (!(await findPublicCategoryById(container, category.id))) {
    categoryNotFound(handle)
  }

  return category as ProductCategoryTree & {
    id: string
    name: string
    handle: string
  }
}

async function categorySourceProducts(
  container: MedusaContainer,
  ids: string[]
) {
  const productModuleService = container.resolve(Modules.PRODUCT)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const products: CatalogSourceProduct[] = []

  for (let skip = 0; ; skip += PRODUCT_QUERY_BATCH_SIZE) {
    const productBatch = await productModuleService.listProducts(
      {
        status: ProductStatus.PUBLISHED,
        categories: { id: ids },
      },
      {
        select: ["id"],
        take: PRODUCT_QUERY_BATCH_SIZE,
        skip,
        order: { id: "ASC" },
      }
    )

    if (!productBatch.length) {
      break
    }

    const { data } = await query.graph({
      entity: "product",
      fields: catalogProductFields,
      filters: { id: productBatch.map((product) => product.id) },
      pagination: {
        take: PRODUCT_QUERY_BATCH_SIZE,
        skip: 0,
      },
    })
    const batch = data as CatalogSourceProduct[]

    products.push(...batch)

    if (productBatch.length < PRODUCT_QUERY_BATCH_SIZE) {
      break
    }
  }

  return products
}

export async function listCategoryProducts(
  container: MedusaContainer,
  handle: string,
  requestedPage = 1,
  subcategoryHandle?: string
): Promise<CategoryProductsResponse> {
  const category = await publicCategoryTree(container, handle)
  const selectedCategory = subcategoryHandle
    ? categoryByHandle(category, subcategoryHandle, true)
    : category

  if (!selectedCategory) {
    categoryNotFound(subcategoryHandle ?? handle)
  }

  if (!isPublicCategory(selectedCategory)) {
    categoryNotFound(subcategoryHandle ?? handle)
  }

  const sourceProducts = await categorySourceProducts(
    container,
    categoryIds(selectedCategory)
  )
  const sortedProducts = sortCatalogProducts(
    sourceProducts
      .map((product) => mapCatalogProduct(product))
      .filter((product): product is CatalogProduct => !!product)
  )
  const page = Math.max(1, Math.floor(requestedPage))
  const offset = (page - 1) * CATEGORY_PRODUCTS_LIMIT
  const total = sortedProducts.length

  return {
    category: {
      id: category.id,
      name: category.name,
      handle: category.handle,
    },
    products: sortedProducts.slice(offset, offset + CATEGORY_PRODUCTS_LIMIT),
    total,
    page,
    limit: CATEGORY_PRODUCTS_LIMIT,
    pages: Math.ceil(total / CATEGORY_PRODUCTS_LIMIT),
  }
}
