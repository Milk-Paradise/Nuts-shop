import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { catalogProductFields } from "../../api/catalog/utils"
import {
  buildCatalogIndexDocument,
  createCategoryPathResolver,
  type CatalogIndexDocument,
} from "./documents"
import { MEILISEARCH_MODULE } from "."
import type MeilisearchModuleService from "./service"

const PAGE_SIZE = 200

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: Record<string, unknown>
  }): Promise<{ data: Record<string, any>[] }>
}

type CatalogSyncResult = {
  indexed: number
  deleted: number
  skipped: number
}

export type InventoryEntity =
  | "inventory_item"
  | "inventory_level"
  | "reservation_item"

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
}

function meilisearch(container: MedusaContainer) {
  return container.resolve<MeilisearchModuleService>(MEILISEARCH_MODULE)
}

async function queryCategories(container: MedusaContainer) {
  const { data } = await query(container).graph({
    entity: "product_category",
    fields: [
      "id",
      "name",
      "parent_category_id",
      "is_active",
      "is_internal",
    ],
    pagination: { take: 1000, skip: 0 },
  })

  return data
}

async function queryProducts(
  container: MedusaContainer,
  filters?: Record<string, unknown>
) {
  const products: Record<string, any>[] = []
  let offset = 0

  while (true) {
    const { data } = await query(container).graph({
      entity: "product",
      fields: catalogProductFields,
      filters,
      pagination: { take: PAGE_SIZE, skip: offset },
    })

    products.push(...data)

    if (data.length < PAGE_SIZE) {
      break
    }

    offset += PAGE_SIZE
  }

  return products
}

async function buildDocuments(
  container: MedusaContainer,
  products: Record<string, any>[]
) {
  const resolveCategoryPath = createCategoryPathResolver(
    await queryCategories(container)
  )
  const documents: CatalogIndexDocument[] = []
  let skipped = 0

  for (const product of products) {
    const document = buildCatalogIndexDocument(product, resolveCategoryPath)

    if (document) {
      documents.push(document)
    } else {
      skipped++
    }
  }

  return { documents, skipped }
}

export async function reindexCatalogDocuments(
  container: MedusaContainer
): Promise<CatalogSyncResult> {
  const products = await queryProducts(container)
  const { documents, skipped } = await buildDocuments(container, products)

  await meilisearch(container).resetCatalogIndex(documents)

  return {
    indexed: documents.length,
    deleted: 0,
    skipped,
  }
}

export async function syncCatalogProductsByIds(
  container: MedusaContainer,
  productIds: string[]
): Promise<CatalogSyncResult> {
  const ids = unique(productIds)

  if (!ids.length) {
    return { indexed: 0, deleted: 0, skipped: 0 }
  }

  const products = await queryProducts(container, { id: ids })
  const foundProductIds = new Set(
    products.map((product) => product.id).filter(Boolean)
  )
  const missingProductIds = ids.filter((id) => !foundProductIds.has(id))
  const { documents, skipped } = await buildDocuments(container, products)
  const documentIds = new Set(documents.map((document) => document.id))
  const invalidProductIds = ids.filter(
    (id) => foundProductIds.has(id) && !documentIds.has(id)
  )
  const deleteIds = [...missingProductIds, ...invalidProductIds]
  const service = meilisearch(container)

  await service.configureCatalogIndex()
  await service.upsertCatalogDocuments(documents)
  await service.deleteCatalogDocuments(deleteIds)

  return {
    indexed: documents.length,
    deleted: deleteIds.length,
    skipped,
  }
}

export async function productIdsByVariantIds(
  container: MedusaContainer,
  variantIds: string[]
) {
  const ids = unique(variantIds)

  if (!ids.length) {
    return []
  }

  const { data } = await query(container).graph({
    entity: "product_variant",
    fields: ["id", "product_id"],
    filters: { id: ids },
    pagination: { take: ids.length, skip: 0 },
  })

  return unique(
    data
      .map((variant) => variant.product_id)
      .filter((id): id is string => typeof id === "string")
  )
}

export async function productIdsByInventoryEntityIds(
  container: MedusaContainer,
  entity: InventoryEntity,
  entityIds: string[]
) {
  const ids = unique(entityIds)

  if (!ids.length) {
    return []
  }

  let inventoryItemIds = ids

  if (entity !== "inventory_item") {
    const { data } = await query(container).graph({
      entity,
      fields: ["id", "inventory_item_id"],
      filters: { id: ids },
      pagination: { take: ids.length, skip: 0 },
    })

    inventoryItemIds = unique(
      data
        .map((item) => item.inventory_item_id)
        .filter((id): id is string => typeof id === "string")
    )
  }

  if (!inventoryItemIds.length) {
    return []
  }

  const { data } = await query(container).graph({
    entity: "inventory_item",
    fields: ["id", "variants.product_id"],
    filters: { id: inventoryItemIds },
    pagination: { take: inventoryItemIds.length, skip: 0 },
  })

  return unique(
    data
      .flatMap((inventoryItem) => inventoryItem.variants ?? [])
      .map((variant) => variant.product_id)
      .filter((id): id is string => typeof id === "string")
  )
}
