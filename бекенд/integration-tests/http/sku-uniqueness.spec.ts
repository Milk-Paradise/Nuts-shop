import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

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

function adminHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function seedProductWithVariant(
  container: MedusaContainer,
  input: {
    title: string
    handle: string
    sku: string
    shippingProfileId: string
    salesChannelId: string
  }
) {
  const {
    result: [product],
  } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: input.title,
          handle: input.handle,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: input.shippingProfileId,
          options: [{ title: "Фасовка", values: ["1 л"] }],
          variants: [
            {
              title: "1 л",
              sku: input.sku,
              manage_inventory: true,
              options: { Фасовка: "1 л" },
              prices: [
                {
                  amount: 1000,
                  currency_code: COMMERCE_BASELINE.currencyCode,
                },
              ],
            },
          ],
          sales_channels: [{ id: input.salesChannelId }],
        },
      ],
    },
  })

  const { data: products } = await query(container).graph({
    entity: "product",
    fields: ["id", "variants.id", "variants.sku"],
    filters: { id: product.id },
  })

  return products[0]
}

function apiProductInput(input: {
  title: string
  handle: string
  shippingProfileId: string
  salesChannelId: string
  sku?: string | null
}) {
  return {
    title: input.title,
    handle: input.handle,
    status: ProductStatus.PUBLISHED,
    shipping_profile_id: input.shippingProfileId,
    options: [{ title: "Фасовка", values: ["1 л"] }],
    variants: [
      {
        title: "1 л",
        sku: input.sku,
        manage_inventory: true,
        options: { Фасовка: "1 л" },
        prices: [
          {
            amount: 1000,
            currency_code: COMMERCE_BASELINE.currencyCode,
          },
        ],
      },
    ],
    sales_channels: [{ id: input.salesChannelId }],
  }
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
        "sku-admin@test.com",
        testEnv.JWT_SECRET
      )
    })

    describe("variant SKU uniqueness", () => {
      it("keeps the Medusa storage-level partial unique index on variant SKU", async () => {
        const result = await dbConnection.raw(
          `
            select indexdef
            from pg_indexes
            where tablename = 'product_variant'
              and indexname = 'IDX_product_variant_sku_unique'
          `
        )

        expect(result.rows[0]?.indexdef).toContain("UNIQUE")
        expect(result.rows[0]?.indexdef).toContain("sku")
        expect(result.rows[0]?.indexdef).toContain("deleted_at IS NULL")
      })

      it("rejects saving an admin variant with a duplicate SKU", async () => {
        const duplicateSku = "T13-DUPLICATE-SKU"
        const sourceProduct = await seedProductWithVariant(getContainer(), {
          title: "T13 Source Product",
          handle: "t13-source-product",
          sku: duplicateSku,
          shippingProfileId: baseline.shippingProfile.id,
          salesChannelId: baseline.salesChannel.id,
        })
        const targetProduct = await seedProductWithVariant(getContainer(), {
          title: "T13 Target Product",
          handle: "t13-target-product",
          sku: "T13-UNIQUE-SKU",
          shippingProfileId: baseline.shippingProfile.id,
          salesChannelId: baseline.salesChannel.id,
        })
        const targetVariantId = targetProduct.variants[0].id

        expect(sourceProduct.variants[0].sku).toBe(duplicateSku)

        await expect(
          api.post(
            `/admin/products/${targetProduct.id}/variants/${targetVariantId}`,
            { sku: duplicateSku },
            { headers: adminHeaders(adminToken) }
          )
        ).rejects.toMatchObject({
          response: {
            status: 400,
            data: {
              message: expect.stringContaining(duplicateSku),
            },
          },
        })
      })

      it("allows published products without a SKU", async () => {
        const first = await api.post(
          "/admin/products",
          apiProductInput({
            title: "T13 No SKU One",
            handle: "t13-no-sku-one",
            shippingProfileId: baseline.shippingProfile.id,
            salesChannelId: baseline.salesChannel.id,
            sku: "",
          }),
          { headers: adminHeaders(adminToken) }
        )
        const second = await api.post(
          "/admin/products",
          apiProductInput({
            title: "T13 No SKU Two",
            handle: "t13-no-sku-two",
            shippingProfileId: baseline.shippingProfile.id,
            salesChannelId: baseline.salesChannel.id,
            sku: "",
          }),
          { headers: adminHeaders(adminToken) }
        )

        expect(first.status).toBe(200)
        expect(second.status).toBe(200)
        expect(first.data.product.variants[0].sku).toBeNull()
        expect(second.data.product.variants[0].sku).toBeNull()
      })
    })
  },
})
