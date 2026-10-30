import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  updateCustomersWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  COMMERCE_BASELINE,
  seedCommerceBaseline,
} from "../../src/scripts/seed-commerce"
import abandonedCartReminderJob from "../../src/jobs/abandoned-cart-reminder"
import { signAbandonedCartUnsubscribeToken } from "../../src/lib/abandoned-cart-links"

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

async function seedReminderProduct(
  container: MedusaContainer,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  input: { title: string; sku: string }
) {
  const {
    result: [category],
  } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [
        {
          name: `${input.title} Category`,
          handle: uniqueHandle("reminder-category"),
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
          handle: uniqueHandle("reminder-product"),
          description: "Integration abandoned-cart product.",
          status: ProductStatus.PUBLISHED,
          category_ids: [category.id],
          shipping_profile_id: baseline.shippingProfile.id,
          thumbnail: "https://example.test/reminder-product.jpg",
          options: [{ title: "Фасовка", values: ["1 л"] }],
          variants: [
            {
              title: "1 л",
              sku: input.sku,
              manage_inventory: true,
              allow_backorder: false,
              options: { Фасовка: "1 л" },
              prices: [{ amount: 1500, currency_code: COMMERCE_BASELINE.currencyCode }],
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
    throw new Error("Seeded reminder product is missing inventory linkage")
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: [
        {
          inventory_item_id: inventoryItemId,
          location_id: baseline.stockLocation.id,
          stocked_quantity: 10,
        },
      ],
    },
  })

  return { variantId: variant.id as string }
}

async function createStoreCart(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  variantId: string
) {
  const response = await api.post(
    "/store/carts",
    {
      region_id: baseline.region.id,
      sales_channel_id: baseline.salesChannel.id,
      items: [{ variant_id: variantId, quantity: 1 }],
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

async function attachCartToCustomer(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  cartId: string,
  cookie: string
) {
  await api.post(
    `/store/carts/${encodeURIComponent(cartId)}/merge-into-customer`,
    {},
    { headers: storeHeaders(baseline, { Cookie: cookie }) }
  )
}

async function backdateCart(dbConnection: any, cartId: string, when: Date) {
  await dbConnection.raw(`update "cart" set updated_at = ? where id = ?`, [
    when.toISOString(),
    cartId,
  ])
}

async function countReminderEmails(container: MedusaContainer, to: string) {
  const notificationService = container.resolve(Modules.NOTIFICATION)
  const notifications = await notificationService.listNotifications({
    to,
    template: "abandoned-cart-reminder",
  })

  return notifications.length
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, dbConnection, getContainer }) => {
    let baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>

    beforeAll(async () => {
      baseline = await seedCommerceBaseline(getContainer())
    })

    describe("abandoned cart reminder job (T20)", () => {
      it("sends exactly one reminder per continuous 7-day inactivity window, and resends after a fresh 7-day quiet period following a modification", async () => {
        const container = getContainer()
        const product = await seedReminderProduct(container, baseline, {
          title: "T20 Abandoned Cart Product",
          sku: uniqueHandle("T20-ABANDONED").toUpperCase(),
        })
        const email = `${uniqueHandle("t20-abandoned")}@test.com`

        const cart = await createStoreCart(api, baseline, product.variantId)
        const session = await createCustomerSession(api, baseline, email)
        await attachCartToCustomer(api, baseline, cart.id, session.cookie)

        const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000)
        await backdateCart(dbConnection, cart.id, nineDaysAgo)

        await abandonedCartReminderJob(container)
        expect(await countReminderEmails(container, email)).toBe(1)

        // Re-running the job the same day (cart still quiet, already reminded)
        // must not send a second email for the same inactivity window.
        await abandonedCartReminderJob(container)
        expect(await countReminderEmails(container, email)).toBe(1)

        // Customer touches the cart again (a later updated_at than the first
        // reminder's snapshot), then goes quiet for another 7 days — this
        // starts a new inactivity window and should trigger a fresh email.
        const sevenDaysAndAnHourAgo = new Date(
          Date.now() - (7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)
        )
        await backdateCart(dbConnection, cart.id, sevenDaysAndAnHourAgo)
        await abandonedCartReminderJob(container)
        expect(await countReminderEmails(container, email)).toBe(2)
      })

      it("does not remind a guest cart even if it carries a captured email", async () => {
        const container = getContainer()
        const product = await seedReminderProduct(container, baseline, {
          title: "T20 Guest Cart Product",
          sku: uniqueHandle("T20-GUEST").toUpperCase(),
        })
        const email = `${uniqueHandle("t20-guest")}@test.com`

        const cart = await createStoreCart(api, baseline, product.variantId)
        // Simulate a guest checkout email capture without ever registering an
        // account: attach a guest (has_account: false) customer directly.
        const customerModuleService = container.resolve(Modules.CUSTOMER)
        const guestCustomer = await customerModuleService.createCustomers({
          email,
          has_account: false,
        })
        const cartModuleService = container.resolve(Modules.CART)
        await cartModuleService.updateCarts(cart.id, { customer_id: guestCustomer.id })

        await backdateCart(dbConnection, cart.id, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000))

        await abandonedCartReminderJob(container)
        expect(await countReminderEmails(container, email)).toBe(0)
      })

      it("does not remind a customer who opted out", async () => {
        const container = getContainer()
        const product = await seedReminderProduct(container, baseline, {
          title: "T20 Opt Out Product",
          sku: uniqueHandle("T20-OPTOUT").toUpperCase(),
        })
        const email = `${uniqueHandle("t20-optout")}@test.com`

        const cart = await createStoreCart(api, baseline, product.variantId)
        const session = await createCustomerSession(api, baseline, email)
        await attachCartToCustomer(api, baseline, cart.id, session.cookie)

        await updateCustomersWorkflow(container).run({
          input: {
            selector: { id: session.customer.id },
            update: { metadata: { abandoned_cart_reminders_opt_out: true } },
          },
        })

        await backdateCart(dbConnection, cart.id, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000))

        await abandonedCartReminderJob(container)
        expect(await countReminderEmails(container, email)).toBe(0)
      })
    })

    describe("abandoned cart unsubscribe (T22)", () => {
      it("persists opt-out and stops future reminders after following the emailed link", async () => {
        const container = getContainer()
        const product = await seedReminderProduct(container, baseline, {
          title: "T22 Unsubscribe Product",
          sku: uniqueHandle("T22-UNSUB").toUpperCase(),
        })
        const email = `${uniqueHandle("t22-unsub")}@test.com`

        const cart = await createStoreCart(api, baseline, product.variantId)
        const session = await createCustomerSession(api, baseline, email)
        await attachCartToCustomer(api, baseline, cart.id, session.cookie)

        const token = signAbandonedCartUnsubscribeToken(session.customer.id)
        const response = await api.post(
          "/store/unsubscribe/abandoned-cart",
          { customer_id: session.customer.id, token },
          { headers: publishableHeaders(baseline) }
        )

        expect(response.status).toBe(200)
        expect(response.data.opted_out).toBe(true)

        const { data: customers } = await query(container).graph({
          entity: "customer",
          fields: ["id", "metadata"],
          filters: { id: session.customer.id },
        })
        expect(customers[0]?.metadata?.abandoned_cart_reminders_opt_out).toBe(true)

        await backdateCart(dbConnection, cart.id, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000))
        await abandonedCartReminderJob(container)
        expect(await countReminderEmails(container, email)).toBe(0)
      })

      it("preserves other customer metadata keys when opting out", async () => {
        const container = getContainer()
        const email = `${uniqueHandle("t22-preserve-metadata")}@test.com`
        const session = await createCustomerSession(api, baseline, email)

        await updateCustomersWorkflow(container).run({
          input: {
            selector: { id: session.customer.id },
            update: { metadata: { favorite_color: "red" } },
          },
        })

        const token = signAbandonedCartUnsubscribeToken(session.customer.id)
        await api.post(
          "/store/unsubscribe/abandoned-cart",
          { customer_id: session.customer.id, token },
          { headers: publishableHeaders(baseline) }
        )

        const { data: customers } = await query(container).graph({
          entity: "customer",
          fields: ["id", "metadata"],
          filters: { id: session.customer.id },
        })

        expect(customers[0]?.metadata).toMatchObject({
          favorite_color: "red",
          abandoned_cart_reminders_opt_out: true,
        })
      })

      it("rejects a forged or mismatched unsubscribe token and leaves the preference untouched", async () => {
        const email = `${uniqueHandle("t22-forged")}@test.com`
        const session = await createCustomerSession(api, baseline, email)

        await expect(
          api.post(
            "/store/unsubscribe/abandoned-cart",
            { customer_id: session.customer.id, token: "not-a-real-token" },
            { headers: publishableHeaders(baseline) }
          )
        ).rejects.toMatchObject({ response: { status: 400 } })

        const { data: customers } = await query(getContainer()).graph({
          entity: "customer",
          fields: ["id", "metadata"],
          filters: { id: session.customer.id },
        })
        expect(customers[0]?.metadata?.abandoned_cart_reminders_opt_out).toBeUndefined()
      })

      it("rejects a request missing customer_id or token", async () => {
        await expect(
          api.post(
            "/store/unsubscribe/abandoned-cart",
            { customer_id: "cus_123" },
            { headers: publishableHeaders(baseline) }
          )
        ).rejects.toMatchObject({ response: { status: 400 } })
      })
    })
  },
})
