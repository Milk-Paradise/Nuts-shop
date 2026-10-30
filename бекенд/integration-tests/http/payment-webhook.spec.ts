import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"

import { POST } from "../../src/api/hooks/payment/yookassa_yookassa/route"
import { PAYMENT_PROVIDER_CONFIG_MODULE } from "../../src/modules/payment-provider-config"
import PaymentProviderConfigModuleService from "../../src/modules/payment-provider-config/service"
import { CATALOG_PAYMENT_STATUS_CHECK_REQUESTED } from "../../src/workflows/verify-catalog-payment-webhook"

const testEnv = {
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  STORE_CORS: process.env.STORE_CORS ?? "http://localhost:8000",
  ADMIN_CORS: process.env.ADMIN_CORS ?? "http://localhost:9000",
  AUTH_CORS: process.env.AUTH_CORS ?? "http://localhost:9000",
  JWT_SECRET: process.env.JWT_SECRET ?? "test-jwt-secret",
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? "test-cookie-secret",
  AUTH_MFA_ENCRYPTION_KEY:
    process.env.AUTH_MFA_ENCRYPTION_KEY ?? "test-mfa-encryption-key",
  PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY:
    process.env.PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY ??
    Buffer.alloc(32, 9).toString("base64"),
}

function webhookBody() {
  return {
    type: "notification",
    event: "payment.succeeded",
    object: {
      id: "yookassa-payment-webhook-1",
      status: "succeeded",
      amount: { value: "1500.00", currency: "RUB" },
      metadata: { session_id: "payses_webhook_test" },
    },
  }
}

function mockResponse() {
  const state: { status: number; body?: unknown } = { status: 200 }
  const response = {
    status(code: number) {
      state.status = code
      return response
    },
    json(body: unknown) {
      state.body = body
      return response
    },
    sendStatus(code: number) {
      state.status = code
      return response
    },
  }

  return { response, state }
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ getContainer, api }) => {
    describe("YooKassa payment webhook", () => {
      it("mounts the protected project handler on the standard Medusa hook URL", async () => {
        await expect(
          api.post("/hooks/payment/yookassa_yookassa", webhookBody(), {
            headers: { "x-forwarded-for": "77.75.156.11" },
          })
        ).rejects.toMatchObject({ response: { status: 403 } })
      })

      it("rejects a foreign source before contacting YooKassa", async () => {
        const container = getContainer()
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        const getPayment = jest.fn()
        function FakeYooCheckout() {
          return { constructor: FakeYooCheckout, getPayment }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const { response, state } = mockResponse()

        await POST(
          {
            scope: container,
            body: webhookBody(),
            headers: { "x-forwarded-for": "77.75.156.11" },
            ip: "127.0.0.1",
            socket: { remoteAddress: "127.0.0.1" },
          } as never,
          response as never
        )

        expect(state.status).toBe(403)
        expect(getPayment).not.toHaveBeenCalled()
      })

      it("returns 503 when server-side provider configuration is missing", async () => {
        const container = getContainer()
        const { response, state } = mockResponse()

        await POST(
          {
            scope: container,
            body: webhookBody(),
            headers: {},
            socket: { remoteAddress: "77.75.156.11" },
          } as never,
          response as never
        )

        expect(state.status).toBe(503)
      })

      it("uses a newer API status when the webhook event is stale", async () => {
        const container = getContainer()
        const configService = container.resolve(
          PAYMENT_PROVIDER_CONFIG_MODULE
        ) as PaymentProviderConfigModuleService
        await configService.savePaymentProviderConfig({
          provider_id: "yookassa",
          shop_id: "shop-test",
          secret_key: "secret-test",
          mode: "test",
          is_enabled: true,
          actor_id: "user_test",
        })
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        const staleBody = webhookBody()
        staleBody.event = "payment.waiting_for_capture"
        const getPayment = jest.fn(async () => webhookBody().object)
        function FakeYooCheckout() {
          return { constructor: FakeYooCheckout, getPayment }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const eventBus = container.resolve(Modules.EVENT_BUS) as any
        const emitSpy = jest.spyOn(eventBus, "emit")
        emitSpy.mockClear()
        const { response, state } = mockResponse()

        await POST(
          {
            scope: container,
            body: staleBody,
            headers: {},
            socket: { remoteAddress: "77.75.156.11" },
          } as never,
          response as never
        )

        const emittedStatusChecks = emitSpy.mock.calls
          .flatMap(([messages]) => (Array.isArray(messages) ? messages : [messages]))
          .filter(
            (message) => message?.name === CATALOG_PAYMENT_STATUS_CHECK_REQUESTED
          )

        expect(state.status).toBe(200)
        expect(getPayment).toHaveBeenCalledTimes(1)
        expect(emittedStatusChecks).toHaveLength(1)
      })

      it("verifies through the YooKassa API and emits one check for duplicate delivery", async () => {
        const container = getContainer()
        const configService = container.resolve(
          PAYMENT_PROVIDER_CONFIG_MODULE
        ) as PaymentProviderConfigModuleService
        await configService.savePaymentProviderConfig({
          provider_id: "yookassa",
          shop_id: "shop-test",
          secret_key: "secret-test",
          mode: "test",
          is_enabled: true,
          actor_id: "user_test",
        })
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        const apiPayment = {
          ...webhookBody().object,
          amount: { value: "1499.00", currency: "RUB" },
          metadata: { session_id: "payses_api_truth" },
        }
        const deliveredBody = webhookBody()
        deliveredBody.object.amount.value = "1.00"
        deliveredBody.object.metadata.session_id = "payses_tampered"
        const getPayment = jest.fn(async () => apiPayment)
        function FakeYooCheckout() {
          return { constructor: FakeYooCheckout, getPayment }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const eventBus = container.resolve(Modules.EVENT_BUS) as any
        const emitSpy = jest.spyOn(eventBus, "emit")
        emitSpy.mockClear()

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const { response, state } = mockResponse()
          await POST(
            {
              scope: container,
              body: deliveredBody,
              headers: {},
              ip: "77.75.156.11",
              socket: { remoteAddress: "77.75.156.11" },
            } as never,
            response as never
          )
          expect(state.status).toBe(200)
        }

        const emittedStatusChecks = emitSpy.mock.calls
          .flatMap(([messages]) => (Array.isArray(messages) ? messages : [messages]))
          .filter(
            (message) => message?.name === CATALOG_PAYMENT_STATUS_CHECK_REQUESTED
          )

        expect(getPayment).toHaveBeenCalledTimes(1)
        expect(emittedStatusChecks).toHaveLength(1)
        expect(emittedStatusChecks[0].data).toEqual({
          provider_id: "yookassa",
          provider_payment_id: "yookassa-payment-webhook-1",
          session_id: "payses_api_truth",
          event: "payment.succeeded",
        })
      })
    })
  },
})
