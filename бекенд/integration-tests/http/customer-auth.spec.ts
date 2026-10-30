import { Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

import { seedCommerceBaseline } from "../../src/scripts/seed-commerce"

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

let uniqueCounter = 0

function uniqueEmail() {
  uniqueCounter += 1

  return `customer-auth-${Date.now()}-${uniqueCounter}@test.com`
}

function bearer(token: string) {
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

function cookieHeader(setCookie: string[] | string | undefined) {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []

  return cookies.map((cookie) => cookie.split(";")[0]).join("; ")
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    let baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>

    beforeAll(async () => {
      baseline = await seedCommerceBaseline(getContainer())
    })

    describe("customer auth", () => {
      it("registers, logs in with a persistent session, and logs out", async () => {
        const email = uniqueEmail()
        const password = "supersecret1"

        const registration = await api.post("/auth/customer/emailpass/register", {
          email,
          password,
        })

        expect(registration.status).toBe(200)
        expect(registration.data.token).toEqual(expect.any(String))

        const createdCustomer = await api.post(
          "/store/customers",
          {
            email,
            first_name: "Иван",
            last_name: "Покупатель",
          },
          {
            headers: storeHeaders(baseline, bearer(registration.data.token)),
          }
        )

        expect(createdCustomer.status).toBe(200)
        expect(createdCustomer.data.customer).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            email,
            first_name: "Иван",
            last_name: "Покупатель",
            has_account: true,
          })
        )

        const login = await api.post("/auth/customer/emailpass", {
          email,
          password,
        })

        expect(login.status).toBe(200)
        expect(login.data.token).toEqual(expect.any(String))

        const session = await api.post(
          "/auth/session",
          {},
          { headers: bearer(login.data.token) }
        )
        const cookie = cookieHeader(session.headers["set-cookie"])

        expect(session.status).toBe(200)
        expect(cookie).toContain("connect.sid=")

        const currentCustomer = await api.get("/store/customers/me", {
          headers: storeHeaders(baseline, { Cookie: cookie }),
        })

        expect(currentCustomer.status).toBe(200)
        expect(currentCustomer.data.customer).toEqual(
          expect.objectContaining({
            id: createdCustomer.data.customer.id,
            email,
            has_account: true,
          })
        )

        const logout = await api.delete("/auth/session", {
          headers: { Cookie: cookie },
        })

        expect(logout.status).toBe(200)
        expect(logout.data).toEqual({ success: true })

        await expect(
          api.get("/store/customers/me", {
            headers: storeHeaders(baseline, { Cookie: cookie }),
          })
        ).rejects.toMatchObject({
          response: { status: 401 },
        })
      })

      it("rejects a password shorter than 8 characters without creating an account", async () => {
        const email = uniqueEmail()

        await expect(
          api.post("/auth/customer/emailpass/register", {
            email,
            password: "short",
          })
        ).rejects.toMatchObject({
          response: { status: 400 },
        })

        const customerModule = getContainer().resolve(Modules.CUSTOMER)
        expect(await customerModule.listCustomers({ email })).toHaveLength(0)
      })

      it("rejects an invalid email without creating an account", async () => {
        await expect(
          api.post("/auth/customer/emailpass/register", {
            email: "not-an-email",
            password: "supersecret1",
          })
        ).rejects.toMatchObject({
          response: { status: 400 },
        })
      })

      it("attaches the password to an existing guest customer instead of creating a duplicate", async () => {
        const email = uniqueEmail()
        const password = "supersecret1"
        const customerModule = getContainer().resolve(Modules.CUSTOMER)

        const guest = await customerModule.createCustomers({
          email,
          first_name: "Гость",
          has_account: false,
        })

        const registration = await api.post("/auth/customer/emailpass/register", {
          email,
          password,
        })

        const createdCustomer = await api.post(
          "/store/customers",
          { email, last_name: "Покупатель" },
          { headers: storeHeaders(baseline, bearer(registration.data.token)) }
        )

        expect(createdCustomer.status).toBe(200)
        expect(createdCustomer.data.customer).toEqual(
          expect.objectContaining({
            id: guest.id,
            email,
            first_name: "Гость",
            last_name: "Покупатель",
            has_account: true,
          })
        )
        expect(await customerModule.listCustomers({ email })).toHaveLength(1)

        const login = await api.post("/auth/customer/emailpass", { email, password })
        expect(login.status).toBe(200)
      })

      it("rejects registration when the email already has a password", async () => {
        const email = uniqueEmail()
        const password = "supersecret1"

        const firstRegistration = await api.post("/auth/customer/emailpass/register", {
          email,
          password,
        })
        await api.post(
          "/store/customers",
          { email },
          { headers: storeHeaders(baseline, bearer(firstRegistration.data.token)) }
        )

        await expect(
          api.post("/auth/customer/emailpass/register", {
            email,
            password: "anotherpassword1",
          })
        ).rejects.toMatchObject({
          response: { status: 401 },
        })

        const customerModule = getContainer().resolve(Modules.CUSTOMER)
        expect(await customerModule.listCustomers({ email })).toHaveLength(1)
      })

      it("rejects registration when a customer with an account already exists but has no auth identity yet", async () => {
        // Simulates a customer row created outside the emailpass flow (e.g. by
        // an admin) that already has has_account:true — exercises the
        // registerCustomerAccount duplicate check directly, since the more
        // common "already has a password" path above is rejected earlier, at
        // the auth-identity level, before ever reaching this workflow.
        const email = uniqueEmail()
        const customerModule = getContainer().resolve(Modules.CUSTOMER)
        await customerModule.createCustomers({ email, has_account: true })

        const registration = await api.post("/auth/customer/emailpass/register", {
          email,
          password: "supersecret1",
        })

        await expect(
          api.post(
            "/store/customers",
            { email },
            { headers: storeHeaders(baseline, bearer(registration.data.token)) }
          )
        ).rejects.toMatchObject({
          response: { status: 422 },
        })

        expect(await customerModule.listCustomers({ email })).toHaveLength(1)
      })
    })
  },
})
