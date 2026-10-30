import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  STOCK_RESERVATION_WINDOW_MS,
  syncMoyskladStock,
} from "../../src/jobs/moysklad-stock-sync"
import { MOYSKLAD_INTEGRATION_MODULE } from "../../src/modules/moysklad-integration"
import type MoyskladIntegrationService from "../../src/modules/moysklad-integration/service"
import {
  COMMERCE_BASELINE,
  seedCommerceBaseline,
} from "../../src/scripts/seed-commerce"
import { createAdminToken } from "./test-helpers/admin-token"

const testEnv = {
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  STORE_CORS: process.env.STORE_CORS ?? "http://localhost:8000,http://localhost:9000",
  ADMIN_CORS: process.env.ADMIN_CORS ?? "http://localhost:9000,http://localhost:7001",
  AUTH_CORS:
    process.env.AUTH_CORS ??
    "http://localhost:9000,http://localhost:7001,http://localhost:8000",
  JWT_SECRET: process.env.JWT_SECRET ?? "test-jwt-secret",
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? "test-cookie-secret",
  AUTH_MFA_ENCRYPTION_KEY:
    process.env.AUTH_MFA_ENCRYPTION_KEY ?? "test-mfa-encryption-key",
  MOYSKLAD_ENCRYPTION_KEY:
    process.env.MOYSKLAD_ENCRYPTION_KEY ?? "test-moysklad-encryption-key",
}

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }): Promise<{ data: Record<string, any>[] }>
}

type TestApiClient = {
  post(
    path: string,
    body?: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<any>
}

type StockProduct = {
  variantId: string
  inventoryItemId: string
  inventoryLevelId: string
}

let uniqueCounter = 0

function uniqueValue(prefix: string) {
  uniqueCounter += 1
  return `${prefix}-${Date.now()}-${uniqueCounter}`
}

function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
}

function publishableHeaders(
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>
) {
  const token = baseline.publishableApiKey.token

  if (typeof token !== "string" || !token.startsWith("pk_")) {
    throw new Error("Seeded publishable API key did not expose a raw token")
  }

  return { "x-publishable-api-key": token }
}

function stockClient(rows: Array<{ code: string; stock: number }>) {
  return {
    async *getProductBatches() {
      yield {
        rows: rows.map((row, index) => ({
          id: `moysklad-product-${index}`,
          code: row.code,
          meta: {
            href: `https://api.moysklad.test/entity/product/${index}`,
          },
        })),
      }
    },
    async *getStockBatches() {
      yield {
        rows: rows.map((row, index) => ({
          ...row,
          meta: {
            href: `https://api.moysklad.test/entity/product/${index}`,
          },
        })),
      }
    },
  }
}

async function syncStockWithTestClient(
  container: MedusaContainer,
  client: ReturnType<typeof stockClient>,
  now: Date
) {
  const service = container.resolve(
    MOYSKLAD_INTEGRATION_MODULE
  ) as MoyskladIntegrationService

  await service.setConnectionActive(true)
  try {
    return await syncMoyskladStock(container, client as never, now)
  } finally {
    await service.setConnectionActive(false)
  }
}

async function seedStockProduct(
  container: MedusaContainer,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  input: { sku: string; stockedQuantity: number }
): Promise<StockProduct> {
  const {
    result: [category],
  } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [
        {
          name: uniqueValue("MoySklad stock category"),
          handle: uniqueValue("moysklad-stock-category").toLowerCase(),
          is_active: true,
        },
      ],
    },
  })
  const {
    result: [product],
  } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: uniqueValue("MoySklad stock product"),
          handle: uniqueValue("moysklad-stock-product").toLowerCase(),
          status: ProductStatus.PUBLISHED,
          category_ids: [category.id],
          shipping_profile_id: baseline.shippingProfile.id,
          options: [{ title: "Volume", values: ["1L"] }],
          variants: [
            {
              title: "1L",
              sku: input.sku,
              manage_inventory: true,
              options: { Volume: "1L" },
              prices: [
                {
                  amount: 1000,
                  currency_code: COMMERCE_BASELINE.currencyCode,
                },
              ],
            },
          ],
          sales_channels: [{ id: baseline.salesChannel.id }],
        },
      ],
    },
  })
  const { data: products } = await query(container).graph({
    entity: "product",
    fields: ["variants.id", "variants.inventory_items.inventory_item_id"],
    filters: { id: product.id },
  })
  const variant = products[0]?.variants?.[0]
  const inventoryItemId = variant?.inventory_items?.[0]?.inventory_item_id

  if (!variant?.id || !inventoryItemId) {
    throw new Error("Seeded product is missing its inventory linkage")
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: [
        {
          inventory_item_id: inventoryItemId,
          location_id: baseline.stockLocation.id,
          stocked_quantity: input.stockedQuantity,
        },
      ],
    },
  })
  const { data: levels } = await query(container).graph({
    entity: "inventory_level",
    fields: ["id"],
    filters: {
      inventory_item_id: inventoryItemId,
      location_id: baseline.stockLocation.id,
    },
  })

  if (!levels[0]?.id) {
    throw new Error("Seeded product is missing its inventory level")
  }

  return {
    variantId: variant.id,
    inventoryItemId,
    inventoryLevelId: levels[0].id,
  }
}

async function stockedQuantity(container: MedusaContainer, levelId: string) {
  const { data } = await query(container).graph({
    entity: "inventory_level",
    fields: ["id", "stocked_quantity"],
    filters: { id: levelId },
  })

  return Number(data[0]?.stocked_quantity)
}

async function placeSiteOrder(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  variantId: string,
  quantity: number
) {
  const cart = await api.post(
    "/store/carts",
    {
      region_id: baseline.region.id,
      sales_channel_id: baseline.salesChannel.id,
      items: [{ variant_id: variantId, quantity }],
    },
    { headers: publishableHeaders(baseline) }
  )
  const checkout = await api.post(
    "/store/catalog/checkout",
    {
      cart_id: cart.data.cart.id,
      name: "Integration Stock Test",
      phone: "+7 (999) 000-00-00",
      email: `${uniqueValue("stock-order")}@test.com`,
      city: "Moscow",
      street: "Test street",
      house: "1",
      apartment: "1",
      comment: "Stock sync integration test",
    },
    { headers: publishableHeaders(baseline) }
  )

  return checkout.data.order.id as string
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, dbConnection, getContainer }) => {
    let baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>
    let adminToken: string

    beforeAll(async () => {
      const container = getContainer()

      baseline = await seedCommerceBaseline(container)
      adminToken = await createAdminToken(
        container,
        `${uniqueValue("stock-admin")}@test.com`,
        testEnv.JWT_SECRET
      )

      const service = container.resolve(
        MOYSKLAD_INTEGRATION_MODULE
      ) as MoyskladIntegrationService
      await service.saveConnectionConfig({
        credentials: { type: "token", token: "integration-test-token" },
        isActive: false,
      })
    })

    describe("MoySklad stock sync", () => {
      it("subtracts only non-canceled site orders created in the last 48 hours", async () => {
        const container = getContainer()
        const sku = uniqueValue("T19-WINDOW").toUpperCase()
        const product = await seedStockProduct(container, baseline, {
          sku,
          stockedQuantity: 50,
        })
        const now = new Date("2026-08-20T12:00:00.000Z")
        const recentOrderId = await placeSiteOrder(
          api,
          baseline,
          product.variantId,
          5
        )
        const canceledOrderId = await placeSiteOrder(
          api,
          baseline,
          product.variantId,
          3
        )
        const oldOrderId = await placeSiteOrder(
          api,
          baseline,
          product.variantId,
          4
        )

        await api.post(
          `/admin/orders/${canceledOrderId}/cancel`,
          {},
          { headers: { Authorization: `Bearer ${adminToken}` } }
        )
        await dbConnection.raw(
          `update "order" set created_at = ? where id = ?`,
          [new Date(now.getTime() - 2 * 60 * 60 * 1000), recentOrderId]
        )
        await dbConnection.raw(
          `update "order" set created_at = ? where id = ?`,
          [new Date(now.getTime() - 3 * 60 * 60 * 1000), canceledOrderId]
        )
        await dbConnection.raw(
          `update "order" set created_at = ? where id = ?`,
          [
            new Date(now.getTime() - STOCK_RESERVATION_WINDOW_MS - 60 * 1000),
            oldOrderId,
          ]
        )

        await syncStockWithTestClient(
          container,
          stockClient([{ code: sku, stock: 20 }]),
          now
        )

        expect(await stockedQuantity(container, product.inventoryLevelId)).toBe(15)
      })

      it("does not update any candidate for missing or ambiguous SKU matches", async () => {
        const container = getContainer()
        const missingSku = uniqueValue("T19-MISSING").toUpperCase()
        const unaffected = await seedStockProduct(container, baseline, {
          sku: uniqueValue("T19-OTHER").toUpperCase(),
          stockedQuantity: 31,
        })
        const duplicateSku = uniqueValue("T19-DUPLICATE").toUpperCase()
        const firstCandidate = await seedStockProduct(container, baseline, {
          sku: duplicateSku,
          stockedQuantity: 41,
        })
        const secondCandidateOriginalSku = uniqueValue("T19-SECOND").toUpperCase()
        const secondCandidate = await seedStockProduct(container, baseline, {
          sku: secondCandidateOriginalSku,
          stockedQuantity: 42,
        })
        const index = await dbConnection.raw(
          `select indexdef from pg_indexes where indexname = 'IDX_product_variant_sku_unique'`
        )
        const recreateIndex = index.rows[0]?.indexdef as string | undefined

        if (!recreateIndex) {
          throw new Error("Variant SKU unique index was not found")
        }

        await dbConnection.raw(`drop index "IDX_product_variant_sku_unique"`)

        try {
          await dbConnection.raw(
            `update product_variant set sku = ? where id = ?`,
            [duplicateSku, secondCandidate.variantId]
          )

          await syncStockWithTestClient(
            container,
            stockClient([
              { code: missingSku, stock: 7 },
              { code: duplicateSku, stock: 8 },
            ]),
            new Date()
          )

          expect(await stockedQuantity(container, unaffected.inventoryLevelId)).toBe(31)
          expect(
            await stockedQuantity(container, firstCandidate.inventoryLevelId)
          ).toBe(41)
          expect(
            await stockedQuantity(container, secondCandidate.inventoryLevelId)
          ).toBe(42)
        } finally {
          await dbConnection.raw(
            `update product_variant set sku = ? where id = ?`,
            [secondCandidateOriginalSku, secondCandidate.variantId]
          )
          await dbConnection.raw(recreateIndex)
        }
      })
    })
  },
})
