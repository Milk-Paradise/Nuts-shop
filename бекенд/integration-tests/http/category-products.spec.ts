import { medusaIntegrationTestRunner, type TestApiClient } from "@medusajs/test-utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createShippingProfilesWorkflow,
} from "@medusajs/medusa/core-flows"

import { ensureTestPublishableApiKey } from "./test-helpers/publishable-key"

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

type SeededCategoryProducts = {
  rootHandle: string
  childHandle: string
  hiddenHandle: string
  hiddenDescendantHandle: string
  internalHandle: string
  foreignHandle: string
  visibleProductIds: string[]
  selectedProductIds: string[]
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
      data: [{ name: "Category Products Test Shipping", type: "default" }],
    },
  })

  return result[0].id
}

async function createCategory(
  container: MedusaContainer,
  input: {
    name: string
    handle: string
    parent_category_id?: string
    is_active?: boolean
    is_internal?: boolean
  }
) {
  const { result } = await createProductCategoriesWorkflow(container).run({
    input: { product_categories: [input] },
  })

  return result[0]
}

async function seedCategoryProducts(
  container: MedusaContainer
): Promise<SeededCategoryProducts> {
  const shippingProfileId = await ensureShippingProfile(container)
  const root = await createCategory(container, {
    name: "Integration Root",
    handle: "integration-root",
    is_active: true,
    is_internal: false,
  })
  const child = await createCategory(container, {
    name: "Integration Child",
    handle: "integration-child",
    parent_category_id: root.id,
    is_active: true,
    is_internal: false,
  })
  const grandchild = await createCategory(container, {
    name: "Integration Grandchild",
    handle: "integration-grandchild",
    parent_category_id: child.id,
    is_active: true,
    is_internal: false,
  })
  const hidden = await createCategory(container, {
    name: "Integration Hidden",
    handle: "integration-hidden",
    parent_category_id: root.id,
    is_active: false,
    is_internal: false,
  })
  const hiddenDescendant = await createCategory(container, {
    name: "Integration Hidden Descendant",
    handle: "integration-hidden-descendant",
    parent_category_id: hidden.id,
    is_active: true,
    is_internal: false,
  })
  const internal = await createCategory(container, {
    name: "Integration Internal",
    handle: "integration-internal",
    parent_category_id: root.id,
    is_active: true,
    is_internal: true,
  })
  const foreign = await createCategory(container, {
    name: "Integration Foreign",
    handle: "integration-foreign",
    is_active: true,
    is_internal: false,
  })
  const productDefinitions = [
    { title: "00 Root Product", categoryId: root.id },
    { title: "01 Child Product", categoryId: child.id },
    ...Array.from({ length: 24 }, (_, index) => ({
      title: `02 Grandchild Product ${String(index).padStart(2, "0")}`,
      categoryId: grandchild.id,
    })),
    { title: "99 Hidden Product", categoryId: hidden.id },
    {
      title: "99 Hidden Descendant Product",
      categoryId: hiddenDescendant.id,
    },
  ]
  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: productDefinitions.map((definition, index) => ({
        title: definition.title,
        handle: `integration-category-product-${String(index).padStart(2, "0")}`,
        status: ProductStatus.PUBLISHED,
        category_ids: [definition.categoryId],
        shipping_profile_id: shippingProfileId,
        options: [{ title: "Фасовка", values: ["1 л"] }],
        variants: [
          {
            title: "1 л",
            sku: `INTEGRATION-CATEGORY-${String(index).padStart(2, "0")}`,
            manage_inventory: false,
            options: { Фасовка: "1 л" },
            prices: [{ amount: 1000 + index, currency_code: "rub" }],
          },
        ],
      })),
    },
  })
  const idsByTitle = new Map(products.map((product) => [product.title, product.id]))
  const visibleTitles = productDefinitions
    .slice(0, 26)
    .map((definition) => definition.title)
    .sort((left, right) => left.localeCompare(right, "ru"))
  const selectedTitles = productDefinitions
    .slice(1, 26)
    .map((definition) => definition.title)
    .sort((left, right) => left.localeCompare(right, "ru"))

  return {
    rootHandle: root.handle,
    childHandle: child.handle,
    hiddenHandle: hidden.handle,
    hiddenDescendantHandle: hiddenDescendant.handle,
    internalHandle: internal.handle,
    foreignHandle: foreign.handle,
    visibleProductIds: visibleTitles.map((title) => idsByTitle.get(title)!),
    selectedProductIds: selectedTitles.map((title) => idsByTitle.get(title)!),
  }
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    let seeded: SeededCategoryProducts

    beforeAll(async () => {
      seeded = await seedCategoryProducts(getContainer())
      const { token } = await ensureTestPublishableApiKey(
        getContainer(),
        "category-products"
      )
      const axiosApi = api as TestApiClient & {
        defaults: { headers: { common: Record<string, string> } }
      }
      axiosApi.defaults.headers.common["x-publishable-api-key"] = token
    })

    describe("category products API", () => {
      it("includes descendants recursively and paginates after 24 products", async () => {
        const firstPage = await api.get(
          `/store/catalog/categories/${seeded.rootHandle}/products?page=1`
        )
        const secondPage = await api.get(
          `/store/catalog/categories/${seeded.rootHandle}/products?page=2`
        )

        expect(firstPage.status).toBe(200)
        expect(firstPage.data).toEqual(
          expect.objectContaining({ total: 26, page: 1, limit: 24, pages: 2 })
        )
        expect(firstPage.data.products.map(({ id }) => id)).toEqual(
          seeded.visibleProductIds.slice(0, 24)
        )
        expect(secondPage.data).toEqual(
          expect.objectContaining({ total: 26, page: 2, limit: 24, pages: 2 })
        )
        expect(secondPage.data.products.map(({ id }) => id)).toEqual(
          seeded.visibleProductIds.slice(24)
        )
      })

      it("filters to a selected subcategory and its descendants", async () => {
        const firstPage = await api.get(
          `/store/catalog/categories/${seeded.rootHandle}/products?page=1&subcategory=${seeded.childHandle}`
        )
        const secondPage = await api.get(
          `/store/catalog/categories/${seeded.rootHandle}/products?page=2&subcategory=${seeded.childHandle}`
        )

        expect(firstPage.data).toEqual(
          expect.objectContaining({ total: 25, page: 1, limit: 24, pages: 2 })
        )
        expect(firstPage.data.products.map(({ id }) => id)).toEqual(
          seeded.selectedProductIds.slice(0, 24)
        )
        expect(secondPage.data.products.map(({ id }) => id)).toEqual(
          seeded.selectedProductIds.slice(24)
        )
      })

      it("returns controlled errors for hidden, internal, and foreign categories", async () => {
        await expect(
          api.get(`/store/catalog/categories/${seeded.hiddenHandle}/products`)
        ).rejects.toMatchObject({ response: { status: 404 } })
        await expect(
          api.get(`/store/catalog/categories/${seeded.internalHandle}/products`)
        ).rejects.toMatchObject({ response: { status: 404 } })
        await expect(
          api.get(
            `/store/catalog/categories/${seeded.hiddenDescendantHandle}/products`
          )
        ).rejects.toMatchObject({ response: { status: 404 } })
        await expect(
          api.get(
            `/store/catalog/categories/${seeded.rootHandle}/products?subcategory=${seeded.hiddenHandle}`
          )
        ).rejects.toMatchObject({ response: { status: 404 } })
        await expect(
          api.get(
            `/store/catalog/categories/${seeded.rootHandle}/products?subcategory=${seeded.internalHandle}`
          )
        ).rejects.toMatchObject({ response: { status: 404 } })
        await expect(
          api.get(
            `/store/catalog/categories/${seeded.rootHandle}/products?subcategory=${seeded.foreignHandle}`
          )
        ).rejects.toMatchObject({ response: { status: 404 } })
      })
    })
  },
})
