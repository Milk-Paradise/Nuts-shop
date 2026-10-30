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
  updateInventoryLevelsWorkflow,
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
  graph(
    input: {
      entity: string
      fields: string[]
      filters?: Record<string, unknown>
    },
    options?: Record<string, unknown>
  ): Promise<{ data: Record<string, any>[] }>
}

type CheckoutProduct = {
  variantId: string
  inventoryItemId: string
  inventoryLevelId: string
}

type TestApiClient = {
  get(path: string, config?: Record<string, unknown>): Promise<any>
  post(
    path: string,
    body?: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<any>
}

let uniqueCounter = 0

function uniqueHandle(prefix: string) {
  uniqueCounter += 1

  return `${prefix}-${Date.now()}-${uniqueCounter}`
}

function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
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

function storeHeaders(
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  extra: Record<string, string> = {}
) {
  return {
    ...publishableHeaders(baseline),
    ...extra,
  }
}

function cookieHeader(setCookie: string[] | string | undefined) {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []

  return cookies.map((cookie) => cookie.split(";")[0]).join("; ")
}

async function seedMergeProduct(
  container: MedusaContainer,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  input: { title: string; sku: string; stockedQuantity: number }
): Promise<CheckoutProduct> {
  const {
    result: [category],
  } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [
        {
          name: `${input.title} Category`,
          handle: uniqueHandle("cart-merge-category"),
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
          title: input.title,
          handle: uniqueHandle("cart-merge-product"),
          description: "Integration cart-merge product.",
          status: ProductStatus.PUBLISHED,
          category_ids: [category.id],
          shipping_profile_id: baseline.shippingProfile.id,
          thumbnail: "https://example.test/cart-merge-product.jpg",
          options: [{ title: "Фасовка", values: ["1 л"] }],
          variants: [
            {
              title: "1 л",
              sku: input.sku,
              manage_inventory: true,
              allow_backorder: false,
              options: { Фасовка: "1 л" },
              prices: [
                {
                  amount: 1500,
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
    fields: ["id", "variants.id", "variants.inventory_items.inventory_item_id"],
    filters: { id: product.id },
  })
  const variant = products[0]?.variants?.[0]
  const inventoryItemId = variant?.inventory_items?.[0]?.inventory_item_id ?? null

  if (!variant?.id || !inventoryItemId) {
    throw new Error("Seeded cart-merge product is missing inventory linkage")
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
    throw new Error("Seeded cart-merge inventory level was not created")
  }

  return { variantId: variant.id, inventoryItemId, inventoryLevelId: levels[0].id }
}

async function createStoreCart(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  variantId: string,
  quantity = 1
) {
  const response = await api.post(
    "/store/carts",
    {
      region_id: baseline.region.id,
      sales_channel_id: baseline.salesChannel.id,
      items: [{ variant_id: variantId, quantity }],
    },
    { headers: publishableHeaders(baseline) }
  )

  return response.data.cart
}

async function createEmptyStoreCart(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>
) {
  const response = await api.post(
    "/store/carts",
    {
      region_id: baseline.region.id,
      sales_channel_id: baseline.salesChannel.id,
    },
    { headers: publishableHeaders(baseline) }
  )

  return response.data.cart
}

async function createCustomerSession(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  email: string
) {
  const password = "supersecret1"
  const registration = await api.post("/auth/customer/emailpass/register", {
    email,
    password,
  })
  const createdCustomer = await api.post(
    "/store/customers",
    { email },
    { headers: storeHeaders(baseline, bearer(registration.data.token)) }
  )

  const login = await api.post("/auth/customer/emailpass", { email, password })
  const session = await api.post(
    "/auth/session",
    {},
    { headers: bearer(login.data.token) }
  )

  return {
    customer: createdCustomer.data.customer as { id: string; email: string },
    cookie: cookieHeader(session.headers["set-cookie"]),
  }
}

async function mergeCartIntoCustomer(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  cartId: string,
  extraHeaders: Record<string, string> = {}
) {
  return api.post(
    `/store/carts/${encodeURIComponent(cartId)}/merge-into-customer`,
    {},
    { headers: storeHeaders(baseline, extraHeaders) }
  )
}

async function retrieveCart(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  cartId: string
) {
  const response = await api.get(`/store/carts/${encodeURIComponent(cartId)}`, {
    headers: storeHeaders(baseline),
  })

  return response.data.cart
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    let baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>

    beforeAll(async () => {
      baseline = await seedCommerceBaseline(getContainer())
    })

    describe("cart merge on login (T16/T18)", () => {
      it("keeps the larger quantity when the guest and account carts share a variant", async () => {
        const product = await seedMergeProduct(getContainer(), baseline, {
          title: "T18 Merge Sum Paint",
          sku: uniqueHandle("T18-MERGE-SUM").toUpperCase(),
          stockedQuantity: 100,
        })
        const email = `${uniqueHandle("t18-sum")}@test.com`

        // Establish an existing account cart with 2 of the variant.
        const accountCart = await createStoreCart(api, baseline, product.variantId, 2)
        const session = await createCustomerSession(api, baseline, email)
        await mergeCartIntoCustomer(api, baseline, accountCart.id, {
          Cookie: session.cookie,
        })

        // A new guest cart on another device adds 3 more of the same variant.
        const guestCart = await createStoreCart(api, baseline, product.variantId, 3)
        const merge = await mergeCartIntoCustomer(api, baseline, guestCart.id, {
          Cookie: session.cookie,
        })

        const mergedCart = await retrieveCart(api, baseline, merge.data.cart_id)
        const line = mergedCart.items.find(
          (item: { variant_id: string }) => item.variant_id === product.variantId
        )

        expect(mergedCart.items).toHaveLength(1)
        expect(Number(line.quantity)).toBe(3)
      })

      it("unions disjoint line items from both carts", async () => {
        const productA = await seedMergeProduct(getContainer(), baseline, {
          title: "T18 Merge Union A",
          sku: uniqueHandle("T18-MERGE-UNION-A").toUpperCase(),
          stockedQuantity: 100,
        })
        const productB = await seedMergeProduct(getContainer(), baseline, {
          title: "T18 Merge Union B",
          sku: uniqueHandle("T18-MERGE-UNION-B").toUpperCase(),
          stockedQuantity: 100,
        })
        const email = `${uniqueHandle("t18-union")}@test.com`

        const accountCart = await createStoreCart(api, baseline, productA.variantId, 1)
        const session = await createCustomerSession(api, baseline, email)
        await mergeCartIntoCustomer(api, baseline, accountCart.id, {
          Cookie: session.cookie,
        })

        const guestCart = await createStoreCart(api, baseline, productB.variantId, 1)
        const merge = await mergeCartIntoCustomer(api, baseline, guestCart.id, {
          Cookie: session.cookie,
        })

        const mergedCart = await retrieveCart(api, baseline, merge.data.cart_id)
        const variantIds = mergedCart.items.map(
          (item: { variant_id: string }) => item.variant_id
        )

        expect(mergedCart.items).toHaveLength(2)
        expect(variantIds).toEqual(
          expect.arrayContaining([productA.variantId, productB.variantId])
        )
      })

      it("caps the merged quantity to available inventory", async () => {
        const product = await seedMergeProduct(getContainer(), baseline, {
          title: "T18 Merge No Stock Check",
          sku: uniqueHandle("T18-MERGE-NOSTOCK").toUpperCase(),
          stockedQuantity: 5,
        })
        const email = `${uniqueHandle("t18-nostock")}@test.com`

        const accountCart = await createStoreCart(api, baseline, product.variantId, 4)
        const session = await createCustomerSession(api, baseline, email)
        await mergeCartIntoCustomer(api, baseline, accountCart.id, {
          Cookie: session.cookie,
        })

        // Both carts were created with 4 while stock was 5; stock then drops to 2.
        const guestCart = await createStoreCart(api, baseline, product.variantId, 4)
        await updateInventoryLevelsWorkflow(getContainer()).run({
          input: {
            updates: [{
              id: product.inventoryLevelId,
              inventory_item_id: product.inventoryItemId,
              location_id: baseline.stockLocation.id,
              stocked_quantity: 2,
            }],
          },
        })
        const merge = await mergeCartIntoCustomer(api, baseline, guestCart.id, {
          Cookie: session.cookie,
        })

        expect(merge.status).toBe(200)

        const mergedCart = await retrieveCart(api, baseline, merge.data.cart_id)
        const line = mergedCart.items.find(
          (item: { variant_id: string }) => item.variant_id === product.variantId
        )

        expect(Number(line.quantity)).toBe(2)
      })

      it("transfers the guest cart as-is when the customer has no existing account cart", async () => {
        const product = await seedMergeProduct(getContainer(), baseline, {
          title: "T18 Merge No Account Cart",
          sku: uniqueHandle("T18-MERGE-NOACCT").toUpperCase(),
          stockedQuantity: 10,
        })
        const email = `${uniqueHandle("t18-noaccount")}@test.com`

        const guestCart = await createStoreCart(api, baseline, product.variantId, 1)
        const session = await createCustomerSession(api, baseline, email)
        const merge = await mergeCartIntoCustomer(api, baseline, guestCart.id, {
          Cookie: session.cookie,
        })

        expect(merge.data.cart_id).toBe(guestCart.id)

        const mergedCart = await retrieveCart(api, baseline, merge.data.cart_id)
        expect(mergedCart.items).toHaveLength(1)
      })

      it("leaves the account cart untouched when the guest cart is empty", async () => {
        const product = await seedMergeProduct(getContainer(), baseline, {
          title: "T18 Merge Empty Guest",
          sku: uniqueHandle("T18-MERGE-EMPTYGUEST").toUpperCase(),
          stockedQuantity: 10,
        })
        const email = `${uniqueHandle("t18-emptyguest")}@test.com`

        const accountCart = await createStoreCart(api, baseline, product.variantId, 1)
        const session = await createCustomerSession(api, baseline, email)
        await mergeCartIntoCustomer(api, baseline, accountCart.id, {
          Cookie: session.cookie,
        })

        const emptyGuestCart = await createEmptyStoreCart(api, baseline)
        const merge = await mergeCartIntoCustomer(api, baseline, emptyGuestCart.id, {
          Cookie: session.cookie,
        })

        expect(merge.data.cart_id).toBe(accountCart.id)

        const mergedCart = await retrieveCart(api, baseline, merge.data.cart_id)
        expect(mergedCart.items).toHaveLength(1)
      })

      it("does not merge a guest cart id already claimed by a different customer", async () => {
        const product = await seedMergeProduct(getContainer(), baseline, {
          title: "T18 Merge Isolation",
          sku: uniqueHandle("T18-MERGE-ISOLATION").toUpperCase(),
          stockedQuantity: 10,
        })

        const ownerCart = await createStoreCart(api, baseline, product.variantId, 1)
        const ownerSession = await createCustomerSession(
          api,
          baseline,
          `${uniqueHandle("t18-owner")}@test.com`
        )
        await mergeCartIntoCustomer(api, baseline, ownerCart.id, {
          Cookie: ownerSession.cookie,
        })

        // A second customer's device happens to hold the (already-claimed)
        // owner cart id as its "guest cart" — merging must not pull the
        // owner's items into the second customer's account.
        const otherSession = await createCustomerSession(
          api,
          baseline,
          `${uniqueHandle("t18-other")}@test.com`
        )
        await mergeCartIntoCustomer(api, baseline, ownerCart.id, {
          Cookie: otherSession.cookie,
        })

        const ownerCartAfter = await retrieveCart(api, baseline, ownerCart.id)
        expect(ownerCartAfter.customer_id).toBe(ownerSession.customer.id)
        expect(ownerCartAfter.items).toHaveLength(1)
      })

      it("rejects an unauthenticated merge request", async () => {
        const product = await seedMergeProduct(getContainer(), baseline, {
          title: "T18 Merge Auth",
          sku: uniqueHandle("T18-MERGE-AUTH").toUpperCase(),
          stockedQuantity: 10,
        })
        const cart = await createStoreCart(api, baseline, product.variantId, 1)

        await expect(
          api.post(
            `/store/carts/${encodeURIComponent(cart.id)}/merge-into-customer`,
            {},
            { headers: storeHeaders(baseline) }
          )
        ).rejects.toMatchObject({ response: { status: 401 } })
      })

      it("gives the next anonymous visitor a fresh, empty cart independent of a merged customer cart (T17)", async () => {
        const product = await seedMergeProduct(getContainer(), baseline, {
          title: "T18 Device Cart Isolation",
          sku: uniqueHandle("T18-DEVICE-ISOLATION").toUpperCase(),
          stockedQuantity: 10,
        })
        const email = `${uniqueHandle("t18-device")}@test.com`

        const customerCart = await createStoreCart(api, baseline, product.variantId, 1)
        const session = await createCustomerSession(api, baseline, email)
        const merge = await mergeCartIntoCustomer(api, baseline, customerCart.id, {
          Cookie: session.cookie,
        })

        // Simulates the storefront's post-logout behavior (T17): the device
        // forgets the cart id and the next anonymous visitor starts a brand
        // new cart via POST /store/carts, never reusing the signed-out
        // customer's cart id.
        const nextVisitorCart = await createEmptyStoreCart(api, baseline)

        expect(nextVisitorCart.id).not.toBe(merge.data.cart_id)
        expect(nextVisitorCart.items ?? []).toHaveLength(0)

        const customerCartAfter = await retrieveCart(api, baseline, merge.data.cart_id)
        expect(customerCartAfter.customer_id).toBe(session.customer.id)
        expect(customerCartAfter.items).toHaveLength(1)
      })
    })
  },
})
