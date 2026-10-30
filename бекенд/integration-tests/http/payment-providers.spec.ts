import { medusaIntegrationTestRunner, type TestApiClient } from "@medusajs/test-utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"
import jwt from "jsonwebtoken"

import { PAYMENT_PROVIDER_CONFIG_MODULE } from "../../src/modules/payment-provider-config"
import PaymentProviderConfigModuleService from "../../src/modules/payment-provider-config/service"
import { ensureTestPublishableApiKey } from "./test-helpers/publishable-key"

// `/store/catalog/payment-providers` and `set-payment-provider-enabled`
// both scope availability by `store.default_region_id`. Without a region,
// `listDefaultPaymentScopes` returns no scopes at all, so enabling a
// provider silently becomes a no-op — this helper gives the test store one.
async function ensureDefaultRegion(container: MedusaContainer) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_region_id"],
  })
  const store = stores[0]
  if (store?.default_region_id) {
    return
  }

  const {
    result: [region],
  } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        { name: "Test region", currency_code: "rub", countries: ["ru"] },
      ],
    },
  })

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: { default_region_id: region.id },
    },
  })
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
  MEDUSA_FF_RBAC: process.env.MEDUSA_FF_RBAC ?? "true",
  PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY:
    process.env.PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY ??
    Buffer.alloc(32, 7).toString("base64"),
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    let adminToken: string

    beforeEach(() => {
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue({ ok: true, status: 200 } as Response)
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    beforeAll(async () => {
      adminToken = jwt.sign(
        {
          actor_id: "user_payment_providers_admin",
          actor_type: "user",
          auth_identity_id: "auth_payment_providers_admin",
          app_metadata: {
            user_id: "user_payment_providers_admin",
            roles: ["role_super_admin"],
          },
        },
        testEnv.JWT_SECRET
      )
      await ensureDefaultRegion(getContainer())
      const { token } = await ensureTestPublishableApiKey(
        getContainer(),
        "payment-providers"
      )
      const axiosApi = api as TestApiClient & {
        defaults: { headers: { common: Record<string, string> } }
      }
      axiosApi.defaults.headers.common["x-publishable-api-key"] = token
    })

    async function seedYooKassaConfiguration(isEnabled = false) {
      const paymentProviderConfigService = getContainer().resolve(
        PAYMENT_PROVIDER_CONFIG_MODULE
      ) as PaymentProviderConfigModuleService

      await paymentProviderConfigService.savePaymentProviderConfig({
        provider_id: "yookassa",
        shop_id: "shop-1",
        secret_key: "test_secret_key",
        mode: "test",
        is_enabled: isEnabled,
        actor_id: "user_test",
      })
    }

    describe("admin payment providers API", () => {
      it("rejects unauthenticated requests", async () => {
        await expect(api.get("/admin/payment-providers")).rejects.toMatchObject({
          response: { status: 401 },
        })
      })

      it("rejects an authenticated user without the configuration permission", async () => {
        const tokenWithoutPermission = jwt.sign(
          {
            actor_id: "user_without_payment_provider_permission",
            actor_type: "user",
            auth_identity_id: "auth_without_payment_provider_permission",
            app_metadata: {
              user_id: "user_without_payment_provider_permission",
              roles: [],
            },
          },
          testEnv.JWT_SECRET
        )

        await expect(
          api.get("/admin/payment-providers", {
            headers: { Authorization: `Bearer ${tokenWithoutPermission}` },
          })
        ).rejects.toMatchObject({ response: { status: 403 } })
      })

      it("requires shop ID and secret key on the first save", async () => {
        await expect(
          api.post(
            "/admin/payment-providers/yookassa",
            { shop_id: "shop-1", mode: "test" },
            { headers: { Authorization: `Bearer ${adminToken}` } }
          )
        ).rejects.toMatchObject({ response: { status: 400 } })
      })

      it("does not enable a provider without a valid configuration", async () => {
        await expect(
          api.post(
            "/admin/payment-providers/yookassa/status",
            { is_enabled: true },
            { headers: { Authorization: `Bearer ${adminToken}` } }
          )
        ).rejects.toMatchObject({ response: { status: 400 } })
      })

      it("rejects invalid credentials before changing the provider status", async () => {
        await seedYooKassaConfiguration()
        ;(global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          status: 401,
        } as Response)

        await expect(
          api.post(
            "/admin/payment-providers/yookassa/status",
            { is_enabled: true },
            { headers: { Authorization: `Bearer ${adminToken}` } }
          )
        ).rejects.toMatchObject({ response: { status: 400 } })

        const paymentProviderConfigService = getContainer().resolve(
          PAYMENT_PROVIDER_CONFIG_MODULE
        ) as PaymentProviderConfigModuleService
        await expect(
          paymentProviderConfigService.retrieveAdminPaymentProviderConfig(
            "yookassa"
          )
        ).resolves.toEqual(expect.objectContaining({ is_enabled: false }))
      })

      it("enables and disables a configured provider for new payment sessions", async () => {
        await seedYooKassaConfiguration()

        const beforeEnable = await api.get(
          "/store/catalog/payment-providers"
        )

        expect(beforeEnable.data.payment_providers).toEqual([])

        const enabled = await api.post(
          "/admin/payment-providers/yookassa/status",
          { is_enabled: true },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        )

        expect(enabled.data.payment_provider).toEqual(
          expect.objectContaining({ is_enabled: true, secret_key_set: true })
        )

        const availableAfterEnable = await api.get(
          "/store/catalog/payment-providers"
        )

        expect(availableAfterEnable.data.payment_providers).toEqual([
          { id: "yookassa", name: "ЮKassa" },
        ])

        await seedYooKassaConfiguration(true)
        const disabled = await api.post(
          "/admin/payment-providers/yookassa/status",
          { is_enabled: false },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        )

        expect(disabled.data.payment_provider).toEqual(
          expect.objectContaining({ is_enabled: false, secret_key_set: true })
        )

        const availableAfterDisable = await api.get(
          "/store/catalog/payment-providers"
        )

        expect(availableAfterDisable.data.payment_providers).toEqual([])
      })

      it("saves configuration without returning its secret", async () => {
        const response = await api.post(
          "/admin/payment-providers/yookassa",
          {
            shop_id: "shop-1",
            secret_key: "test_secret_key",
            mode: "test",
          },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        )

        expect(response.status).toBe(200)
        expect(response.data.payment_provider).toEqual(
          expect.objectContaining({
            provider_id: "yookassa",
            shop_id: "shop-1",
            mode: "test",
            is_enabled: false,
            secret_key_set: true,
          })
        )
        expect(JSON.stringify(response.data)).not.toContain("test_secret_key")
        expect(response.data.payment_provider).not.toHaveProperty(
          "encrypted_secret_key"
        )
      })

      it("keeps the secret key when an existing configuration is edited with an empty key", async () => {
        await seedYooKassaConfiguration()

        const response = await api.post(
          "/admin/payment-providers/yookassa",
          { secret_key: "", mode: "live" },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        )

        expect(response.data.payment_provider).toEqual(
          expect.objectContaining({ mode: "live", secret_key_set: true })
        )
      })

      it("disables replaced credentials until they pass a new control request", async () => {
        await seedYooKassaConfiguration(true)

        const replaced = await api.post(
          "/admin/payment-providers/yookassa",
          { shop_id: "shop-2", secret_key: "replacement-secret" },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        )

        expect(replaced.data.payment_provider).toEqual(
          expect.objectContaining({
            shop_id: "shop-2",
            secret_key_set: true,
            is_enabled: false,
          })
        )

        const enabled = await api.post(
          "/admin/payment-providers/yookassa/status",
          { is_enabled: true },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        )

        expect(enabled.data.payment_provider).toEqual(
          expect.objectContaining({ is_enabled: true })
        )
      })

      it("revokes and clears the secret without returning it from the API", async () => {
        await seedYooKassaConfiguration(true)

        const response = await api.post(
          "/admin/payment-providers/yookassa",
          { secret_key: null },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        )

        expect(response.data.payment_provider).toEqual(
          expect.objectContaining({ is_enabled: false, secret_key_set: false })
        )
        expect(response.data.payment_provider).not.toHaveProperty(
          "encrypted_secret_key"
        )
        expect(JSON.stringify(response.data)).not.toContain("test_secret_key")

        const paymentProviderConfigService = getContainer().resolve(
          PAYMENT_PROVIDER_CONFIG_MODULE
        ) as PaymentProviderConfigModuleService
        await expect(
          paymentProviderConfigService.retrieveRuntimePaymentProviderConfig(
            "yookassa"
          )
        ).resolves.toBeNull()
      })

      it("returns registered provider status without its secret", async () => {
        await seedYooKassaConfiguration()

        const response = await api.get("/admin/payment-providers", {
          headers: { Authorization: `Bearer ${adminToken}` },
        })

        expect(response.status).toBe(200)
        expect(response.data.payment_providers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "yookassa",
              is_enabled: false,
              is_configured: true,
              configuration_status: "configured",
              secret_key_set: true,
            }),
          ])
        )
        expect(JSON.stringify(response.data)).not.toContain("test_secret_key")
        expect(response.data.payment_providers[0]).not.toHaveProperty(
          "encrypted_secret_key"
        )
      })

      it("disables new payments but preserves credentials for existing sessions when its shop ID is cleared", async () => {
        await seedYooKassaConfiguration(true)

        const response = await api.post(
          "/admin/payment-providers/yookassa",
          { shop_id: "" },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        )

        expect(response.data.payment_provider).toEqual(
          expect.objectContaining({ shop_id: "shop-1", is_enabled: false })
        )

        const paymentProviderConfigService = getContainer().resolve(
          PAYMENT_PROVIDER_CONFIG_MODULE
        ) as PaymentProviderConfigModuleService
        const runtimeConfig =
          await paymentProviderConfigService.retrieveRuntimePaymentProviderConfig(
            "yookassa"
          )

        expect(runtimeConfig).toEqual(
          expect.objectContaining({
            shop_id: "shop-1",
            secret_key: "test_secret_key",
            is_enabled: false,
          })
        )
      })
    })
  },
})
