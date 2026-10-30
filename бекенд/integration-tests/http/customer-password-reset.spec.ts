import { generateJwtToken, Modules } from "@medusajs/framework/utils"
import { generateResetPasswordTokenWorkflow } from "@medusajs/medusa/core-flows"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

import { seedCommerceBaseline } from "../../src/scripts/seed-commerce"

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

  return `customer-password-reset-${Date.now()}-${uniqueCounter}@test.com`
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

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    let baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>

    beforeAll(async () => {
      baseline = await seedCommerceBaseline(getContainer())
    })

    async function registerCustomer(email: string, password: string) {
      const registration = await api.post("/auth/customer/emailpass/register", {
        email,
        password,
      })

      await api.post(
        "/store/customers",
        { email },
        { headers: storeHeaders(baseline, bearer(registration.data.token)) }
      )
    }

    // The route only ever emits an event for a subscriber to turn into an
    // email (see src/subscribers/send-password-reset-email.ts, unit-tested
    // separately) — it never returns the token itself. Driving the same
    // workflow the route calls gets a real, verifiable token deterministically,
    // without depending on async event-bus/subscriber timing in this test.
    async function generateResetToken(email: string) {
      const { result } = await generateResetPasswordTokenWorkflow(getContainer()).run({
        input: {
          entityId: email,
          actorType: "customer",
          provider: "emailpass",
          secret: JWT_SECRET,
        },
      })

      return result as string
    }

    describe("customer password reset", () => {
      it("accepts a reset request for an existing email", async () => {
        const email = uniqueEmail()
        await registerCustomer(email, "originalpassword1")

        const response = await api.post("/auth/customer/emailpass/reset-password", {
          identifier: email,
        })

        expect(response.status).toBe(201)
      })

      it("accepts a reset request for an unknown email without leaking whether it exists", async () => {
        const response = await api.post("/auth/customer/emailpass/reset-password", {
          identifier: uniqueEmail(),
        })

        expect(response.status).toBe(201)
      })

      it("sets a new password with a valid token, invalidates the old password, and consumes the token", async () => {
        const email = uniqueEmail()
        await registerCustomer(email, "originalpassword1")

        const token = await generateResetToken(email)

        const update = await api.post(
          "/auth/customer/emailpass/update",
          { password: "newpassword1" },
          { headers: bearer(token) }
        )
        expect(update.status).toBe(200)

        await expect(
          api.post("/auth/customer/emailpass", { email, password: "originalpassword1" })
        ).rejects.toMatchObject({ response: { status: 401 } })

        const loginWithNewPassword = await api.post("/auth/customer/emailpass", {
          email,
          password: "newpassword1",
        })
        expect(loginWithNewPassword.status).toBe(200)
        expect(loginWithNewPassword.data.token).toEqual(expect.any(String))

        await expect(
          api.post(
            "/auth/customer/emailpass/update",
            { password: "yetanotherpassword1" },
            { headers: bearer(token) }
          )
        ).rejects.toMatchObject({ response: { status: 401 } })
      })

      it("rejects a malformed reset token with a clear error, without applying any change", async () => {
        const email = uniqueEmail()
        await registerCustomer(email, "originalpassword1")

        await expect(
          api.post(
            "/auth/customer/emailpass/update",
            { password: "newpassword1" },
            { headers: bearer("not-a-real-token") }
          )
        ).rejects.toMatchObject({ response: { status: 401 } })

        const loginStillWorks = await api.post("/auth/customer/emailpass", {
          email,
          password: "originalpassword1",
        })
        expect(loginStillWorks.status).toBe(200)
      })

      it("rejects an expired reset token with a clear error, without applying any change", async () => {
        const email = uniqueEmail()
        await registerCustomer(email, "originalpassword1")

        // Same shape/secret as a real reset token (see generate-reset-password-token.js),
        // but signed already-expired — verified and rejected before the
        // single-use jti lookup even runs.
        const expiredToken = generateJwtToken(
          { entity_id: email, provider: "emailpass", actor_type: "customer", purpose: "reset" },
          { secret: JWT_SECRET, expiresIn: "-10s", jwtOptions: { jwtid: "expired-test-jti" } }
        )

        await expect(
          api.post(
            "/auth/customer/emailpass/update",
            { password: "newpassword1" },
            { headers: bearer(expiredToken) }
          )
        ).rejects.toMatchObject({ response: { status: 401 } })

        const loginStillWorks = await api.post("/auth/customer/emailpass", {
          email,
          password: "originalpassword1",
        })
        expect(loginStillWorks.status).toBe(200)
      })

      it("sends the reset email end-to-end through the real route, event, and subscriber", async () => {
        const email = uniqueEmail()
        await registerCustomer(email, "originalpassword1")

        const response = await api.post("/auth/customer/emailpass/reset-password", {
          identifier: email,
        })
        expect(response.status).toBe(201)

        const notificationModuleService = getContainer().resolve(Modules.NOTIFICATION)
        const notifications = await notificationModuleService.listNotifications({
          to: email,
          template: "customer-password-reset",
        })

        expect(notifications.length).toBeGreaterThan(0)
        expect(notifications[0].data).toEqual(
          expect.objectContaining({ email, token: expect.any(String) })
        )
      })
    })
  },
})
