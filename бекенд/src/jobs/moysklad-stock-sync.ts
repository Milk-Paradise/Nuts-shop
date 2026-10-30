import type { MedusaContainer } from "@medusajs/framework/types"
import {
  createInventoryLevelsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/core-flows"

import { MOYSKLAD_INTEGRATION_MODULE } from "../modules/moysklad-integration"
import {
  MoyskladClient,
  isMoyskladCredentialsFailure,
} from "../modules/moysklad-integration/client"
import type MoyskladIntegrationService from "../modules/moysklad-integration/service"
import type {
  MoyskladUnmatchedItem,
  MoyskladUnmatchedReason,
} from "../modules/moysklad-integration/stock-sync-report"

type Query = {
  graph(input: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>
}

type StockBatchClient = Pick<
  MoyskladClient,
  "getStockBatches" | "getProductBatches"
>

const VARIANT_PAGE_SIZE = 200
const ORDER_PAGE_SIZE = 200
export const STOCK_RESERVATION_WINDOW_MS = 48 * 60 * 60 * 1000
let stockSyncInProgress = false

type StockTarget = {
  variantId: string
  inventoryItemId: string
  inventoryLevelId?: string
  locationId: string
}

type VariantIdentity = {
  id: string
  sku: string | null
  name: string | null
}

function variantName(variant: Record<string, any>) {
  const productTitle = variant.product?.title?.trim()
  const variantTitle = variant.title?.trim()

  if (productTitle && variantTitle && productTitle !== variantTitle) {
    return `${productTitle} — ${variantTitle}`
  }

  return variantTitle || productTitle || null
}

async function loadAllVariants(query: Query) {
  const variants: Record<string, any>[] = []
  let offset = 0

  while (true) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "sku",
        "title",
        "product.title",
        "inventory_items.inventory_item_id",
        "inventory_items.inventory.location_levels.id",
        "inventory_items.inventory.location_levels.location_id",
      ],
      pagination: {
        take: VARIANT_PAGE_SIZE,
        skip: offset,
        order: { id: "ASC" },
      },
    })

    variants.push(...data)

    if (data.length < VARIANT_PAGE_SIZE) {
      return variants
    }

    offset += VARIANT_PAGE_SIZE
  }
}

async function loadStockTargets(container: MedusaContainer) {
  const query = container.resolve<Query>("query")
  const [{ data: stores }, variants] = await Promise.all([
    query.graph({
      entity: "store",
      fields: ["id", "default_location_id"],
      pagination: { take: 1 },
    }),
    loadAllVariants(query),
  ])
  const defaultLocationId = stores[0]?.default_location_id

  if (!defaultLocationId) {
    throw new Error("Default stock location is not configured.")
  }

  const targetsBySku = new Map<string, StockTarget[]>()
  const variantsBySku = new Map<string, VariantIdentity[]>()
  const variantsWithoutSku: VariantIdentity[] = []

  for (const variant of variants) {
    const identity = {
      id: variant.id,
      sku: variant.sku ?? null,
      name: variantName(variant),
    }

    if (!variant.sku) {
      variantsWithoutSku.push(identity)
      continue
    }

    const variantsForSku = variantsBySku.get(variant.sku) ?? []
    variantsForSku.push(identity)
    variantsBySku.set(variant.sku, variantsForSku)

    for (const inventoryItemLink of variant.inventory_items ?? []) {
      const level = inventoryItemLink.inventory?.location_levels?.find(
        (candidate: Record<string, unknown>) =>
          candidate.location_id === defaultLocationId
      )

      if (!inventoryItemLink.inventory_item_id) {
        continue
      }

      const targets = targetsBySku.get(variant.sku) ?? []
      targets.push({
        variantId: variant.id,
        inventoryItemId: inventoryItemLink.inventory_item_id,
        inventoryLevelId: level?.id,
        locationId: defaultLocationId,
      })
      targetsBySku.set(variant.sku, targets)
    }
  }

  return { targetsBySku, variantsBySku, variantsWithoutSku }
}

function isSiteOrder(order: Record<string, any>) {
  return typeof order.metadata?.checkout_contact_name === "string"
}

async function loadRecentSiteOrderQuantities(
  query: Query,
  now: Date,
  syncedOrderIds = new Set<string>()
) {
  const quantitiesBySku = new Map<string, number>()
  let offset = 0

  while (true) {
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "status",
        "created_at",
        "metadata",
        "total",
        "items.variant_sku",
        "items.quantity",
        "payment_collections.payments.captures.amount",
      ],
      filters: {
        status: { $ne: "canceled" },
        created_at: {
          $gte: new Date(now.getTime() - STOCK_RESERVATION_WINDOW_MS),
          $lte: now,
        },
      },
      pagination: {
        take: ORDER_PAGE_SIZE,
        skip: offset,
        order: { id: "ASC" },
      },
    })

    for (const order of data) {
      const createdAt = new Date(order.created_at).getTime()
      const windowStart = now.getTime() - STOCK_RESERVATION_WINDOW_MS

      if (
        order.status === "canceled" ||
        !Number.isFinite(createdAt) ||
        createdAt < windowStart ||
        createdAt > now.getTime() ||
        !isSiteOrder(order)
      ) {
        continue
      }

      if (syncedOrderIds.has(order.id)) {
        continue
      }

      const payments = (order.payment_collections ?? [])
        .flatMap((collection: Record<string, any>) => collection.payments ?? [])
      const captured = payments
        .flatMap((payment: Record<string, any>) => payment.captures ?? [])
        .reduce((sum: number, capture: Record<string, any>) => sum + Number(capture.amount || 0), 0)
      // Keep compatibility with legacy order fixtures/data that do not expose
      // payment totals. In production, orders with payment data are counted
      // only after the captured amount reaches the order total.
      if (
        payments.length > 0 &&
        order.total != null &&
        captured < Number(order.total)
      ) {
        continue
      }

      for (const item of order.items ?? []) {
        if (!item.variant_sku) {
          continue
        }

        const quantity = Number(item.quantity)

        if (!Number.isFinite(quantity) || quantity <= 0) {
          continue
        }

        quantitiesBySku.set(
          item.variant_sku,
          (quantitiesBySku.get(item.variant_sku) ?? 0) + quantity
        )
      }
    }

    if (data.length < ORDER_PAGE_SIZE) {
      return quantitiesBySku
    }

    offset += ORDER_PAGE_SIZE
  }
}

async function loadMoyskladSkuMatches(
  client: StockBatchClient,
  encryptedCredentials: string
) {
  const productsByCode = new Map<
    string,
    Array<{ id: string; href: string; name: string | null }>
  >()
  const productsByHref = new Map<
    string,
    { id: string; href: string; name: string | null }
  >()

  for await (const batch of client.getProductBatches(encryptedCredentials)) {
    for (const product of batch.rows) {
      const identity = {
        id: product.id,
        href: product.meta.href,
        name: product.name?.trim() || null,
      }
      productsByHref.set(product.meta.href, identity)

      if (!product.code) {
        continue
      }

      const products = productsByCode.get(product.code) ?? []
      products.push(identity)
      productsByCode.set(product.code, products)
    }
  }

  return { productsByCode, productsByHref }
}

function unmatchedVariant(
  variant: VariantIdentity,
  reason: MoyskladUnmatchedReason
): MoyskladUnmatchedItem {
  return {
    source: "medusa_variant",
    source_id: variant.id,
    code: null,
    sku: variant.sku,
    name: variant.name,
    reason,
  }
}

function deduplicateUnmatched(items: MoyskladUnmatchedItem[]) {
  const seen = new Set<string>()

  return items.filter((item) => {
    const key = `${item.source}:${item.source_id}:${item.reason}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

export async function syncMoyskladStock(
  container: MedusaContainer,
  client: StockBatchClient = new MoyskladClient(),
  now: Date = new Date()
) {
  const logger = container.resolve("logger")
  const moyskladService = container.resolve<MoyskladIntegrationService>(
    MOYSKLAD_INTEGRATION_MODULE
  )
  const connectionConfig = await moyskladService.getConnectionConfig()

  if (!connectionConfig?.is_active || !connectionConfig.encrypted_credentials) {
    return false
  }

  const query = container.resolve<Query>("query")
  const { targetsBySku, variantsBySku, variantsWithoutSku } =
    await loadStockTargets(container)
  const { productsByCode, productsByHref } = await loadMoyskladSkuMatches(
    client,
    connectionConfig.encrypted_credentials
  )
  const syncedOrderIds = new Set<string>()
  if (typeof moyskladService.listMoyskladOrderSyncs === "function") {
    const syncs = await moyskladService.listMoyskladOrderSyncs({})
    for (const sync of syncs) {
      if (sync.status === "synced" && sync.moysklad_order_id) {
        syncedOrderIds.add(sync.order_id)
      }
    }
  }
  const recentOrderQuantities = await loadRecentSiteOrderQuantities(query, now, syncedOrderIds)
  const unmatched: MoyskladUnmatchedItem[] = []

  for (const variant of variantsWithoutSku) {
    unmatched.push(unmatchedVariant(variant, "missing_moysklad_match"))
    logger.info(
      `MoySklad stock sync skipped variant ${variant.id}: нет однозначного соответствия (SKU не задан).`
    )
  }

  for (const [sku, variants] of variantsBySku) {
    const medusaVariantCount = variants.length
    const products = productsByCode.get(sku) ?? []
    const moyskladProductCount = products.length

    if (medusaVariantCount > 1) {
      unmatched.push(
        ...variants.map((variant) =>
          unmatchedVariant(variant, "ambiguous_medusa_sku")
        )
      )
    } else if (moyskladProductCount === 0) {
      unmatched.push(unmatchedVariant(variants[0], "missing_moysklad_match"))
    }

    if (medusaVariantCount > 0 && moyskladProductCount > 1) {
      unmatched.push(
        ...products.map((product) => ({
          source: "moysklad_product" as const,
          source_id: product.id,
          code: sku,
          sku: null,
          name: product.name,
          reason: "ambiguous_moysklad_code" as const,
        }))
      )
    }

    if (medusaVariantCount !== 1 || moyskladProductCount !== 1) {
      logger.info(
        `MoySklad stock sync skipped SKU ${sku}: нет однозначного соответствия (Medusa: ${medusaVariantCount}, МойСклад: ${moyskladProductCount}).`
      )
    }
  }

  const appliedSkus = new Set<string>()
  const inventoryErrors: string[] = []

  for await (const batch of client.getStockBatches(
    connectionConfig.encrypted_credentials
  )) {
    for (const stockRow of batch.rows) {
      if (!stockRow.code) {
        const product = productsByHref.get(stockRow.meta.href)
        unmatched.push({
          source: "moysklad_product",
          source_id: product?.id ?? stockRow.meta.href,
          code: null,
          sku: null,
          name: stockRow.name?.trim() || product?.name || null,
          reason: "missing_moysklad_code",
        })
        continue
      }

      const targets = targetsBySku.get(stockRow.code) ?? []
      const medusaVariantCount =
        variantsBySku.get(stockRow.code)?.length ?? 0
      const moyskladProductCount =
        productsByCode.get(stockRow.code)?.length ?? 0

      if (
        appliedSkus.has(stockRow.code) ||
        medusaVariantCount !== 1 ||
        moyskladProductCount !== 1
      ) {
        continue
      }

      appliedSkus.add(stockRow.code)
      const stockedQuantity = Math.max(
        0,
        stockRow.stock - Number(stockRow.reserve ?? 0) -
          (recentOrderQuantities.get(stockRow.code) ?? 0)
      )

      for (const target of targets) {
        try {
          if (target.inventoryLevelId) {
            await updateInventoryLevelsWorkflow(container).run({
              input: {
                updates: [
                  {
                    id: target.inventoryLevelId,
                    inventory_item_id: target.inventoryItemId,
                    location_id: target.locationId,
                    stocked_quantity: stockedQuantity,
                  },
                ],
              },
            })
          } else {
            await createInventoryLevelsWorkflow(container).run({
              input: {
                inventory_levels: [
                  {
                    inventory_item_id: target.inventoryItemId,
                    location_id: target.locationId,
                    stocked_quantity: stockedQuantity,
                  },
                ],
              },
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)

          logger.error(
            `MoySklad stock sync failed for variant ${target.variantId} (SKU ${stockRow.code}): ${message}`
          )
          inventoryErrors.push(
            `вариант ${target.variantId} (SKU ${stockRow.code}): ${message}`
          )
        }
      }
    }
  }

  if (inventoryErrors.length) {
    throw new Error(
      `Не удалось применить остатки для ${inventoryErrors.length} позиций: ${inventoryErrors.join("; ")}`
    )
  }

  return { unmatched: deduplicateUnmatched(unmatched) }
}

export async function runMoyskladStockSyncJob(
  container: MedusaContainer,
  client: StockBatchClient = new MoyskladClient()
) {
  const logger = container.resolve("logger")

  if (stockSyncInProgress) {
    logger.info(
      "MoySklad stock sync skipped: previous cycle is still running."
    )
    return false
  }

  stockSyncInProgress = true

  try {
    const result = await syncMoyskladStock(container, client)

    if (result) {
      const moyskladService = container.resolve<MoyskladIntegrationService>(
        MOYSKLAD_INTEGRATION_MODULE
      )
      await moyskladService.recordStockSyncSuccess(result.unmatched)
    }
    return !!result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    logger.error(`MoySklad stock sync job failed: ${message}`)

    try {
      const moyskladService = container.resolve<MoyskladIntegrationService>(
        MOYSKLAD_INTEGRATION_MODULE
      )
      if (isMoyskladCredentialsFailure(error)) {
        await moyskladService.markCredentialsReentryRequired(message)
      }
      await moyskladService.recordStockSyncFailure(message)
    } catch (recordError) {
      const recordMessage =
        recordError instanceof Error ? recordError.message : String(recordError)
      logger.error(
        `MoySklad stock sync error could not be recorded: ${recordMessage}`
      )
    }
    return false
  } finally {
    stockSyncInProgress = false
  }
}

// Medusa вызывает обработчик как `handler(container, context)`, поэтому второй
// параметр никогда не остаётся пустым и значение по умолчанию у `client` не
// применяется: в него прилетает context фреймворка, у которого нет методов
// клиента МойСклад. Точка входа джобы принимает только container и создаёт
// клиент сама; параметр `client` у runMoyskladStockSyncJob остаётся ради тестов.
export default async function moyskladStockSyncJob(container: MedusaContainer) {
  if (process.env.E2E_RUN === "true") return
  await runMoyskladStockSyncJob(container, new MoyskladClient())
}

export const config = {
  name: "moysklad-stock-sync",
  schedule: "*/15 * * * *",
}
