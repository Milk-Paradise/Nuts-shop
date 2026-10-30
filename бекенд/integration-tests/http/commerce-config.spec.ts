import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  COMMERCE_BASELINE,
  seedCommerceBaseline,
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
  }): Promise<{ data: Record<string, any>[] }>
}

function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ getContainer }) => {
    let seeded: Awaited<ReturnType<typeof seedCommerceBaseline>>

    beforeAll(async () => {
      seeded = await seedCommerceBaseline(getContainer())
    })

    describe("commerce baseline", () => {
      it("creates a RUB Russia region with the system payment provider", async () => {
        const container = getContainer()

        const { data: regions } = await query(container).graph({
          entity: "region",
          fields: [
            "id",
            "name",
            "currency_code",
            "countries.iso_2",
            "payment_providers.id",
          ],
          filters: { id: seeded.region.id },
        })

        expect(regions[0]).toEqual(
          expect.objectContaining({
            name: COMMERCE_BASELINE.regionName,
            currency_code: COMMERCE_BASELINE.currencyCode,
          })
        )
        expect(regions[0].countries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ iso_2: COMMERCE_BASELINE.countryCode }),
          ])
        )
        expect(regions[0].payment_providers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "pp_system_default" }),
          ])
        )

        const { data: stores } = await query(container).graph({
          entity: "store",
          fields: [
            "id",
            "name",
            "default_sales_channel_id",
            "default_region_id",
            "default_location_id",
            "supported_currencies.currency_code",
            "supported_currencies.is_default",
          ],
          filters: { id: seeded.store.id },
        })

        expect(stores[0]).toEqual(
          expect.objectContaining({
            name: COMMERCE_BASELINE.storeName,
            default_sales_channel_id: seeded.salesChannel.id,
            default_region_id: seeded.region.id,
            default_location_id: seeded.stockLocation.id,
          })
        )
        expect(stores[0].supported_currencies).toEqual([
          expect.objectContaining({
            currency_code: COMMERCE_BASELINE.currencyCode,
            is_default: true,
          }),
        ])
      })

      it("links the sales channel, stock location, fulfillment, and shipping option", async () => {
        const container = getContainer()

        const { data: stockLocations } = await query(container).graph({
          entity: "stock_location",
          fields: [
            "id",
            "name",
            "sales_channels.id",
            "fulfillment_providers.id",
            "fulfillment_sets.id",
          ],
          filters: { id: seeded.stockLocation.id },
        })

        expect(stockLocations[0]).toEqual(
          expect.objectContaining({
            name: COMMERCE_BASELINE.stockLocationName,
          })
        )
        expect(stockLocations[0].sales_channels).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: seeded.salesChannel.id }),
          ])
        )
        expect(stockLocations[0].fulfillment_providers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "manual_manual" }),
          ])
        )
        expect(stockLocations[0].fulfillment_sets).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: seeded.fulfillmentSet.id }),
          ])
        )

        const { data: shippingOptions } = await query(container).graph({
          entity: "shipping_option",
          fields: ["id", "name", "provider_id", "service_zone_id"],
          filters: { id: seeded.shippingOption.id },
        })

        expect(shippingOptions[0]).toEqual(
          expect.objectContaining({
            name: COMMERCE_BASELINE.shippingOptionName,
            provider_id: "manual_manual",
            service_zone_id: seeded.serviceZone.id,
          })
        )
      })

      it("allows a product to receive a RUB price and stock level through standard workflows", async () => {
        const container = getContainer()

        const {
          result: [product],
        } = await createProductsWorkflow(container).run({
          input: {
            products: [
              {
                title: "T03 RUB Paint",
                handle: "t03-rub-paint",
                status: ProductStatus.PUBLISHED,
                shipping_profile_id: seeded.shippingProfile.id,
                options: [{ title: "Volume", values: ["1L"] }],
                variants: [
                  {
                    title: "1L",
                    sku: "T03-RUB-PAINT-1L",
                    manage_inventory: true,
                    options: { Volume: "1L" },
                    prices: [
                      {
                        amount: 1500,
                        currency_code: COMMERCE_BASELINE.currencyCode,
                      },
                    ],
                  },
                ],
                sales_channels: [{ id: seeded.salesChannel.id }],
              },
            ],
          },
        })

        const { data: products } = await query(container).graph({
          entity: "product",
          fields: [
            "id",
            "variants.id",
            "variants.sku",
            "variants.price_set.prices.amount",
            "variants.price_set.prices.currency_code",
            "variants.inventory_items.inventory_item_id",
          ],
          filters: { id: product.id },
        })
        const variant = products[0].variants[0]
        const rubPrice = variant.price_set.prices.find(
          (price) => price.currency_code === COMMERCE_BASELINE.currencyCode
        )
        const inventoryItemId = variant.inventory_items[0]?.inventory_item_id

        expect(rubPrice).toEqual(
          expect.objectContaining({
            amount: 1500,
            currency_code: COMMERCE_BASELINE.currencyCode,
          })
        )
        expect(inventoryItemId).toEqual(expect.any(String))

        await createInventoryLevelsWorkflow(container).run({
          input: {
            inventory_levels: [
              {
                inventory_item_id: inventoryItemId,
                location_id: seeded.stockLocation.id,
                stocked_quantity: 12,
              },
            ],
          },
        })

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
            location_id: seeded.stockLocation.id,
          },
        })

        expect(Number(levels[0].stocked_quantity)).toBe(12)
      })
    })
  },
})
