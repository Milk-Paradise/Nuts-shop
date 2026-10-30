import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import seedCommerce, {
  COMMERCE_BASELINE,
  DEMO_CATALOG,
} from "../../src/scripts/seed-commerce"

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
}

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: Record<string, unknown>
  }): Promise<{ data: Record<string, any>[] }>
}

function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ getContainer }) => {
    let stockLocation: Record<string, any>

    beforeAll(async () => {
      const container = getContainer()

      await seedCommerce({ container })

      const { data } = await query(container).graph({
        entity: "stock_location",
        fields: ["id", "name"],
        filters: { name: COMMERCE_BASELINE.stockLocationName },
      })

      stockLocation = data[0]
    })

    describe("demo catalog seed", () => {
      it("creates the demo category tree with parent links", async () => {
        const container = getContainer()
        const expectedHandles = new Set(
          DEMO_CATALOG.categories.map((category) => category.handle)
        )

        const { data } = await query(container).graph({
          entity: "product_category",
          fields: ["id", "name", "handle", "parent_category_id", "is_active"],
          pagination: { take: 100, skip: 0 },
        })

        const categories = data.filter((category) =>
          expectedHandles.has(category.handle)
        )
        const categoriesByHandle = new Map(
          categories.map((category) => [category.handle, category])
        )

        expect(categories).toHaveLength(DEMO_CATALOG.categories.length)

        for (const definition of DEMO_CATALOG.categories) {
          const category = categoriesByHandle.get(definition.handle)

          expect(category).toEqual(
            expect.objectContaining({
              name: definition.name,
              handle: definition.handle,
              is_active: true,
            })
          )

          if (!definition.parentHandle) {
            expect(category?.parent_category_id ?? null).toBeNull()
            continue
          }

          const parent = categoriesByHandle.get(definition.parentHandle)

          expect(parent?.id).toEqual(expect.any(String))
          expect(category?.parent_category_id).toBe(parent?.id)
        }
      })

      it("creates 20-30 products with variants, brands, RUB prices, inventory, and backorder flags", async () => {
        const container = getContainer()
        const expectedHandles = new Set(
          DEMO_CATALOG.products.map((product) => product.handle)
        )

        const { data } = await query(container).graph({
          entity: "product",
          fields: [
            "id",
            "title",
            "handle",
            "status",
            "metadata",
            "categories.handle",
            "variants.id",
            "variants.sku",
            "variants.allow_backorder",
            "variants.price_set.prices.amount",
            "variants.price_set.prices.currency_code",
            "variants.inventory_items.inventory_item_id",
          ],
          pagination: { take: 100, skip: 0 },
        })

        const products = data.filter((product) =>
          expectedHandles.has(product.handle)
        )
        const productsByHandle = new Map(
          products.map((product) => [product.handle, product])
        )
        const statusSources: {
          stockedQuantity: number
          allowBackorder: boolean
        }[] = []

        expect(DEMO_CATALOG.products.length).toBeGreaterThanOrEqual(20)
        expect(DEMO_CATALOG.products.length).toBeLessThanOrEqual(30)
        expect(products).toHaveLength(DEMO_CATALOG.products.length)
        expect(products.some((product) => product.variants?.length > 1)).toBe(
          true
        )

        for (const definition of DEMO_CATALOG.products) {
          const product = productsByHandle.get(definition.handle)

          expect(product).toEqual(
            expect.objectContaining({
              title: definition.title,
              handle: definition.handle,
              status: "published",
            })
          )
          expect(product?.metadata).toEqual(
            expect.objectContaining({
              brand: definition.brand,
              characteristics: definition.characteristics,
            })
          )
          expect(product?.categories).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ handle: definition.categoryHandle }),
            ])
          )
          expect(product?.variants).toHaveLength(definition.variants.length)

          for (const variantDefinition of definition.variants) {
            const variant = product?.variants?.find(
              (item: Record<string, any>) => item.sku === variantDefinition.sku
            )
            const rubPrice = variant?.price_set?.prices?.find(
              (price: Record<string, any>) =>
                price.currency_code === COMMERCE_BASELINE.currencyCode
            )
            const inventoryItemId =
              variant?.inventory_items?.[0]?.inventory_item_id

            expect(variant?.id).toEqual(expect.any(String))
            expect(Boolean(variant?.allow_backorder)).toBe(
              variantDefinition.allowBackorder
            )
            expect(Number(rubPrice?.amount)).toBe(variantDefinition.price)
            expect(inventoryItemId).toEqual(expect.any(String))

            const { data: levels } = await query(container).graph({
              entity: "inventory_level",
              fields: [
                "id",
                "inventory_item_id",
                "location_id",
                "stocked_quantity",
              ],
              filters: {
                inventory_item_id: inventoryItemId,
                location_id: stockLocation.id,
              },
            })
            const stockedQuantity = Number(levels[0]?.stocked_quantity)

            expect(stockedQuantity).toBe(variantDefinition.stockedQuantity)

            statusSources.push({
              stockedQuantity,
              allowBackorder: Boolean(variant?.allow_backorder),
            })
          }
        }

        expect(
          statusSources.some((source) => source.stockedQuantity > 0)
        ).toBe(true)
        expect(
          statusSources.some(
            (source) =>
              source.stockedQuantity === 0 && source.allowBackorder === true
          )
        ).toBe(true)
        expect(
          statusSources.some(
            (source) =>
              source.stockedQuantity === 0 && source.allowBackorder === false
          )
        ).toBe(true)
      })
    })
  },
})
