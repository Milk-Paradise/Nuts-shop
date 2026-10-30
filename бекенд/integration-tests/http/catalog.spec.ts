import { medusaIntegrationTestRunner, type TestApiClient } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
} from "@medusajs/medusa/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"

import { ensureTestPublishableApiKey } from "./test-helpers/publishable-key"

type SeededCatalog = {
  categoryName: string
  publishedId: string
  draftId: string
  outOfStockId: string
  backorderId: string
  publishedSku: string
  publishedSecondSku: string
  publishedVariantId: string
  publishedSecondVariantId: string
  outOfStockSku: string
  outOfStockVariantId: string
  backorderSku: string
  backorderVariantId: string
  draftVariantId: string
}

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

async function ensureShippingProfile(container: MedusaContainer) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })

  if (data[0]?.id) {
    return data[0].id
  }

  const { result } = await createShippingProfilesWorkflow(container).run({
    input: {
      data: [{ name: "Test Shipping", type: "default" }],
    },
  })

  return result[0].id
}

async function seedInventoryLevels(
  container: MedusaContainer,
  stockedBySku: Record<string, number>
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { result: locations } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [{ name: "Test Warehouse" }],
    },
  })

  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["sku", "inventory_items.inventory_item_id"],
    filters: { sku: Object.keys(stockedBySku) },
  })

  const inventoryLevels = variants.map((variant) => {
    const sku = variant.sku
    const inventoryItemId = variant.inventory_items?.[0]?.inventory_item_id

    if (!sku || !inventoryItemId) {
      throw new Error("Seeded catalog variant is missing SKU or inventory item")
    }

    return {
      inventory_item_id: inventoryItemId,
      location_id: locations[0].id,
      stocked_quantity: stockedBySku[sku],
    }
  })

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: inventoryLevels,
    },
  })
}

async function seedCatalog(container: MedusaContainer): Promise<SeededCatalog> {
  const shippingProfileId = await ensureShippingProfile(container)
  const categoryName = "Грунты"

  const { result: categories } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: [
        {
          name: categoryName,
          is_active: true,
        },
      ],
    },
  })

  const category = categories[0]

  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Акриловый грунт серый",
          handle: "test-primer-grey",
          description: "Профессиональный грунт для кузовного ремонта.",
          status: ProductStatus.PUBLISHED,
          category_ids: [category.id],
          shipping_profile_id: shippingProfileId,
          thumbnail: "https://example.test/primer.jpg",
          metadata: {
            brand: "Novol",
            search_keywords: ["аэрозоль", "быстросохнущий"],
            characteristics: {
              Объем: "1 л",
              Цвет: "Серый",
            },
          },
          options: [{ title: "Фасовка", values: ["1 л", "3 л"] }],
          variants: [
            {
              title: "1 л",
              sku: "TEST-PRIMER-GREY-1L",
              manage_inventory: true,
              options: { Фасовка: "1 л" },
              prices: [{ amount: 1200, currency_code: "rub" }],
            },
            {
              title: "3 л",
              sku: "TEST-PRIMER-GREY-3L",
              manage_inventory: true,
              allow_backorder: true,
              options: { Фасовка: "3 л" },
              prices: [{ amount: 3000, currency_code: "rub" }],
            },
          ],
        },
        {
          title: "Черновой грунт",
          handle: "test-primer-draft",
          status: ProductStatus.DRAFT,
          category_ids: [category.id],
          shipping_profile_id: shippingProfileId,
          metadata: {
            brand: "Novol",
          },
          options: [{ title: "Фасовка", values: ["1 л"] }],
          variants: [
            {
              title: "1 л",
              sku: "TEST-PRIMER-DRAFT-1L",
              manage_inventory: true,
              options: { Фасовка: "1 л" },
              prices: [{ amount: 900, currency_code: "rub" }],
            },
          ],
        },
        {
          title: "Растворитель быстрый",
          handle: "test-fast-thinner",
          status: ProductStatus.PUBLISHED,
          category_ids: [category.id],
          shipping_profile_id: shippingProfileId,
          metadata: {
            brand: "Reoflex",
          },
          options: [{ title: "Фасовка", values: ["1 л"] }],
          variants: [
            {
              title: "1 л",
              sku: "TEST-THINNER-FAST-1L",
              manage_inventory: true,
              options: { Фасовка: "1 л" },
              prices: [{ amount: 650, currency_code: "rub" }],
            },
          ],
        },
        {
          title: "Отвердитель стандартный",
          handle: "test-hardener-std",
          status: ProductStatus.PUBLISHED,
          category_ids: [category.id],
          shipping_profile_id: shippingProfileId,
          metadata: {
            brand: "Mipa",
          },
          options: [{ title: "Фасовка", values: ["1 л"] }],
          variants: [
            {
              title: "1 л",
              sku: "TEST-HARDENER-STD-1L",
              manage_inventory: true,
              allow_backorder: true,
              options: { Фасовка: "1 л" },
              prices: [{ amount: 800, currency_code: "rub" }],
            },
          ],
        },
      ],
    },
  })

  await seedInventoryLevels(container, {
    "TEST-PRIMER-GREY-1L": 10,
    "TEST-PRIMER-GREY-3L": 0,
    "TEST-PRIMER-DRAFT-1L": 5,
    "TEST-THINNER-FAST-1L": 0,
    "TEST-HARDENER-STD-1L": 0,
  })

  function variantIdBySku(productIndex: number, sku: string) {
    const variantId = products[productIndex].variants?.find(
      (variant) => variant.sku === sku
    )?.id

    if (!variantId) {
      throw new Error(`Seeded variant not found for SKU ${sku}`)
    }

    return variantId
  }

  return {
    categoryName,
    publishedId: products[0].id,
    draftId: products[1].id,
    outOfStockId: products[2].id,
    backorderId: products[3].id,
    publishedSku: "TEST-PRIMER-GREY-1L",
    publishedSecondSku: "TEST-PRIMER-GREY-3L",
    publishedVariantId: variantIdBySku(0, "TEST-PRIMER-GREY-1L"),
    publishedSecondVariantId: variantIdBySku(0, "TEST-PRIMER-GREY-3L"),
    outOfStockSku: "TEST-THINNER-FAST-1L",
    outOfStockVariantId: variantIdBySku(2, "TEST-THINNER-FAST-1L"),
    backorderSku: "TEST-HARDENER-STD-1L",
    backorderVariantId: variantIdBySku(3, "TEST-HARDENER-STD-1L"),
    draftVariantId: variantIdBySku(1, "TEST-PRIMER-DRAFT-1L"),
  }
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    let seeded: SeededCatalog

    beforeAll(async () => {
      seeded = await seedCatalog(getContainer())
      const { token } = await ensureTestPublishableApiKey(getContainer(), "catalog")
      const axiosApi = api as TestApiClient & {
        defaults: { headers: { common: Record<string, string> } }
      }
      axiosApi.defaults.headers.common["x-publishable-api-key"] = token
    })

    describe("public catalog API", () => {
      it("allows storefront CORS preflight for catalog routes", async () => {
        const response = await api.options("/store/catalog/search", {
          headers: {
            origin: "http://localhost:8000",
            "access-control-request-method": "GET",
          },
        })

        expect(response.status).toBe(204)
        expect(response.headers["access-control-allow-origin"]).toBe(
          "http://localhost:8000"
        )
      })

      it("returns product details for published products and 404 for drafts", async () => {
        const published = await api.get(`/store/catalog/products/${seeded.publishedId}`)

        expect(published.status).toBe(200)
        expect(published.data.product).toEqual(
          expect.objectContaining({
            id: seeded.publishedId,
            variant_id: null,
            article: null,
            description: "Профессиональный грунт для кузовного ремонта.",
            characteristics: {
              Объем: "1 л",
              Цвет: "Серый",
            },
            variants: expect.arrayContaining([
              expect.objectContaining({
                id: expect.any(String),
                title: "1 л",
                article: seeded.publishedSku,
                price: 1200,
                availability: "in_stock",
                options: { Фасовка: "1 л" },
              }),
              expect.objectContaining({
                id: expect.any(String),
                title: "3 л",
                article: seeded.publishedSecondSku,
                price: 3000,
                availability: "backorder",
                options: { Фасовка: "3 л" },
              }),
            ]),
          })
        )
        expect(published.data.product).not.toHaveProperty("metadata")
        expect(published.data.product).not.toHaveProperty("search_keywords")
        expect(published.data.product).not.toHaveProperty("searchKeywords")
        expect(JSON.stringify(published.data.product)).not.toMatch(
          /"(?:search_keywords|searchKeywords)"\s*:/,
        )

        await expect(api.get(`/store/catalog/products/${seeded.draftId}`)).rejects.toMatchObject({
          response: { status: 404 },
        })
      })

      it("validates cart SKUs against availability computed from inventory", async () => {
        const response = await api.post("/store/catalog/cart/validate", {
          skus: [
            seeded.publishedSku,
            seeded.backorderSku,
            seeded.outOfStockSku,
            "MISSING-SKU",
          ],
        })

        expect(response.status).toBe(200)
        expect(response.data.items).toEqual([
          expect.objectContaining({
            sku: seeded.publishedSku,
            purchasable: true,
            problem: null,
            product: expect.objectContaining({
              id: seeded.publishedId,
              variant_id: expect.any(String),
              article: seeded.publishedSku,
              price: 1200,
              availability: "in_stock",
            }),
          }),
          expect.objectContaining({
            sku: seeded.backorderSku,
            purchasable: true,
            problem: null,
            product: expect.objectContaining({
              id: seeded.backorderId,
              variant_id: expect.any(String),
              availability: "backorder",
            }),
          }),
          expect.objectContaining({
            sku: seeded.outOfStockSku,
            purchasable: false,
            problem: "out_of_stock",
            product: expect.objectContaining({
              id: seeded.outOfStockId,
              variant_id: expect.any(String),
              availability: "out_of_stock",
            }),
          }),
          {
            sku: "MISSING-SKU",
            product: null,
            purchasable: false,
            problem: "not_found",
          },
        ])
      })

      it("validates server cart items by variant id and quantity", async () => {
        const response = await api.post("/store/catalog/cart/validate", {
          items: [
            { variant_id: seeded.publishedVariantId, quantity: 2 },
            { variant_id: seeded.publishedVariantId, quantity: 11 },
            { variant_id: seeded.backorderVariantId, quantity: 50 },
            { variant_id: seeded.outOfStockVariantId, quantity: 1 },
            { variant_id: seeded.draftVariantId, quantity: 1 },
            { variant_id: "variant_missing", quantity: 1 },
          ],
        })

        expect(response.status).toBe(200)
        expect(response.data.items).toEqual([
          expect.objectContaining({
            variant_id: seeded.publishedVariantId,
            quantity: 2,
            purchasable: true,
            problem: null,
            available_quantity: 10,
            product: expect.objectContaining({
              id: seeded.publishedId,
              variant_id: seeded.publishedVariantId,
              article: seeded.publishedSku,
              availability: "in_stock",
            }),
          }),
          expect.objectContaining({
            variant_id: seeded.publishedVariantId,
            quantity: 11,
            purchasable: false,
            problem: "insufficient_stock",
            available_quantity: 10,
          }),
          expect.objectContaining({
            variant_id: seeded.backorderVariantId,
            quantity: 50,
            purchasable: true,
            problem: null,
            available_quantity: 0,
            product: expect.objectContaining({
              availability: "backorder",
            }),
          }),
          expect.objectContaining({
            variant_id: seeded.outOfStockVariantId,
            purchasable: false,
            problem: "out_of_stock",
            available_quantity: 0,
          }),
          {
            variant_id: seeded.draftVariantId,
            quantity: 1,
            product: null,
            purchasable: false,
            problem: "not_found",
            available_quantity: null,
          },
          {
            variant_id: "variant_missing",
            quantity: 1,
            product: null,
            purchasable: false,
            problem: "not_found",
            available_quantity: null,
          },
        ])
      })
    })
  },
})
