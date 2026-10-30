import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

import { createAdminToken } from "./test-helpers/admin-token"
import {
  seedCommerceBaseline,
  seedDemoCatalog,
} from "../../src/scripts/seed-commerce"

const JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret"

const testEnv = {
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  STORE_CORS: process.env.STORE_CORS ?? "http://localhost:8000,http://localhost:9000",
  ADMIN_CORS: process.env.ADMIN_CORS ?? "http://localhost:9000,http://localhost:7001",
  AUTH_CORS:
    process.env.AUTH_CORS ??
    "http://localhost:9000,http://localhost:7001,http://localhost:8000",
  JWT_SECRET,
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? "test-cookie-secret",
  AUTH_MFA_ENCRYPTION_KEY:
    process.env.AUTH_MFA_ENCRYPTION_KEY ?? "test-mfa-encryption-key",
}

let uniqueCounter = 0

function uniqueEmail() {
  uniqueCounter += 1

  return `customer-wishlist-${Date.now()}-${uniqueCounter}@test.com`
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
}

function adminHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

function storeHeaders(
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  extra: Record<string, string> = {}
) {
  const token = baseline.publishableApiKey.token

  if (typeof token !== "string" || !token.startsWith("pk_")) {
    throw new Error("Seeded publishable API key did not expose a raw token")
  }

  return {
    "x-publishable-api-key": token,
    ...extra,
  }
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    let baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>
    let demoProductIds: string[]
    let adminToken: string

    beforeAll(async () => {
      const container = getContainer()
      baseline = await seedCommerceBaseline(container)
      const demo = await seedDemoCatalog(container, baseline)
      demoProductIds = demo.products.map((product: { id: string }) => product.id)
      adminToken = await createAdminToken(container, "wishlist-admin@test.com", JWT_SECRET)
    })

    async function registerCustomer() {
      const email = uniqueEmail()
      const password = "supersecret1"
      const registration = await api.post("/auth/customer/emailpass/register", {
        email,
        password,
      })
      await api.post(
        "/store/customers",
        { email },
        { headers: storeHeaders(baseline, bearer(registration.data.token)) }
      )

      const login = await api.post("/auth/customer/emailpass", { email, password })

      return login.data.token as string
    }

    describe("customer wishlist", () => {
      it("returns the raw product-id set via the static /ids route, not the dynamic [productId] route", async () => {
        const token = await registerCustomer()
        const headers = storeHeaders(baseline, bearer(token))

        await api.post(
          "/store/account/wishlist",
          { product_id: demoProductIds[0] },
          { headers }
        )

        const ids = await api.get("/store/account/wishlist/ids", { headers })

        expect(ids.status).toBe(200)
        expect(ids.data.product_ids).toEqual([demoProductIds[0]])
      })

      it("adds a product idempotently and lists it", async () => {
        const token = await registerCustomer()
        const productId = demoProductIds[0]

        const first = await api.post(
          "/store/account/wishlist",
          { product_id: productId },
          { headers: storeHeaders(baseline, bearer(token)) }
        )
        expect(first.status).toBe(200)

        const second = await api.post(
          "/store/account/wishlist",
          { product_id: productId },
          { headers: storeHeaders(baseline, bearer(token)) }
        )
        expect(second.status).toBe(200)
        expect(second.data.item.id).toBe(first.data.item.id)

        const list = await api.get("/store/account/wishlist", {
          headers: storeHeaders(baseline, bearer(token)),
        })

        expect(list.status).toBe(200)
        expect(list.data.count).toBe(1)
        expect(list.data.items).toHaveLength(1)
        expect(list.data.items[0].product_id).toBe(productId)
      })

      it("survives a concurrent double-click without erroring", async () => {
        const token = await registerCustomer()
        const productId = demoProductIds[0]
        const headers = storeHeaders(baseline, bearer(token))

        const [first, second] = await Promise.all([
          api.post("/store/account/wishlist", { product_id: productId }, { headers }),
          api.post("/store/account/wishlist", { product_id: productId }, { headers }),
        ])

        expect(first.status).toBe(200)
        expect(second.status).toBe(200)
        expect(first.data.item.id).toBe(second.data.item.id)

        const list = await api.get("/store/account/wishlist", { headers })
        expect(list.data.count).toBe(1)
      })

      it("removes a product from the wishlist", async () => {
        const token = await registerCustomer()
        const productId = demoProductIds[0]

        await api.post(
          "/store/account/wishlist",
          { product_id: productId },
          { headers: storeHeaders(baseline, bearer(token)) }
        )

        const remove = await api.delete(
          `/store/account/wishlist/${productId}`,
          { headers: storeHeaders(baseline, bearer(token)) }
        )
        expect(remove.status).toBe(200)

        const list = await api.get("/store/account/wishlist", {
          headers: storeHeaders(baseline, bearer(token)),
        })
        expect(list.data.count).toBe(0)
        expect(list.data.items).toHaveLength(0)
      })

      it("removing a product that was never wishlisted is a no-op success", async () => {
        const token = await registerCustomer()
        const headers = storeHeaders(baseline, bearer(token))

        const remove = await api.delete(
          `/store/account/wishlist/${demoProductIds[0]}`,
          { headers }
        )
        expect(remove.status).toBe(200)

        const secondRemove = await api.delete(
          `/store/account/wishlist/${demoProductIds[0]}`,
          { headers }
        )
        expect(secondRemove.status).toBe(200)
      })

      it("keeps one customer's wishlist isolated from another's", async () => {
        const tokenA = await registerCustomer()
        const tokenB = await registerCustomer()
        const productId = demoProductIds[0]

        await api.post(
          "/store/account/wishlist",
          { product_id: productId },
          { headers: storeHeaders(baseline, bearer(tokenA)) }
        )

        const listB = await api.get("/store/account/wishlist", {
          headers: storeHeaders(baseline, bearer(tokenB)),
        })
        expect(listB.data.count).toBe(0)
        expect(listB.data.items).toHaveLength(0)

        const removeAsB = await api.delete(
          `/store/account/wishlist/${productId}`,
          { headers: storeHeaders(baseline, bearer(tokenB)) }
        )
        expect(removeAsB.status).toBe(200)

        const listA = await api.get("/store/account/wishlist", {
          headers: storeHeaders(baseline, bearer(tokenA)),
        })
        expect(listA.data.count).toBe(1)
        expect(listA.data.items[0].product_id).toBe(productId)
      })

      it("excludes a product that was unpublished after being wishlisted", async () => {
        const token = await registerCustomer()
        const productId = demoProductIds[1]

        await api.post(
          "/store/account/wishlist",
          { product_id: productId },
          { headers: storeHeaders(baseline, bearer(token)) }
        )

        const unpublish = await api.post(
          `/admin/products/${productId}`,
          { status: "draft" },
          { headers: adminHeaders(adminToken) }
        )
        expect(unpublish.status).toBe(200)

        const list = await api.get("/store/account/wishlist", {
          headers: storeHeaders(baseline, bearer(token)),
        })

        expect(list.data.count).toBe(0)
        expect(list.data.items).toHaveLength(0)

        await api.post(
          `/admin/products/${productId}`,
          { status: "published" },
          { headers: adminHeaders(adminToken) }
        )
      })

      it("rejects wishlist access without authentication", async () => {
        await expect(
          api.get("/store/account/wishlist", { headers: storeHeaders(baseline) })
        ).rejects.toMatchObject({ response: { status: 401 } })

        await expect(
          api.post(
            "/store/account/wishlist",
            { product_id: demoProductIds[0] },
            { headers: storeHeaders(baseline) }
          )
        ).rejects.toMatchObject({ response: { status: 401 } })
      })

      it("paginates the wishlist listing", async () => {
        const token = await registerCustomer()

        for (const productId of demoProductIds.slice(0, 2)) {
          await api.post(
            "/store/account/wishlist",
            { product_id: productId },
            { headers: storeHeaders(baseline, bearer(token)) }
          )
        }

        const firstPage = await api.get(
          "/store/account/wishlist?offset=0",
          { headers: storeHeaders(baseline, bearer(token)) }
        )
        const secondPage = await api.get(
          "/store/account/wishlist?offset=1",
          { headers: storeHeaders(baseline, bearer(token)) }
        )

        expect(firstPage.data.count).toBe(2)
        expect(firstPage.data.items).toHaveLength(2)
        expect(secondPage.data.items).toHaveLength(1)
        expect(secondPage.data.items[0].product_id).not.toBe(
          firstPage.data.items[0].product_id
        )
      })
    })
  },
})
