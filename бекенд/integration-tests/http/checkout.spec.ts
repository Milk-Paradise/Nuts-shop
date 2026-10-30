import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  createPaymentCollectionForCartWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createOrderFulfillmentWorkflow,
  updateProductVariantsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows"

import { PAYMENT_PROVIDER_CONFIG_MODULE } from "../../src/modules/payment-provider-config"
import PaymentProviderConfigModuleService from "../../src/modules/payment-provider-config/service"
import { PAYMENT_OPERATION_MODULE } from "../../src/modules/payment-operation"
import PaymentOperationModuleService from "../../src/modules/payment-operation/service"
import { expireAbandonedCatalogPaymentCarts } from "../../src/jobs/expire-catalog-payment-carts"
import { listAccountOrders } from "../../src/api/store/account/orders/utils"
import {
  COMMERCE_BASELINE,
  seedCommerceBaseline,
} from "../../src/scripts/seed-commerce"
import { createAdminToken } from "./test-helpers/admin-token"
import {
  CDEK_PROVIDER_KEY,
  OZON_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../src/modules/shipping-provider-registry"
import ShippingProviderRegistryModuleService from "../../src/modules/shipping-provider-registry/service"

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
  PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY:
    process.env.PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY ??
    Buffer.alloc(32, 7).toString("base64"),
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

type AdminOrderItem = {
  variant_id?: string | null
  variant?: {
    id?: string | null
  } | null
  detail?: {
    quantity?: unknown
  } | null
  quantity?: unknown
  raw_quantity?: unknown
}

type CheckoutBodyOverrides = Partial<{
  name: string
  phone: string
  email: string
  city: string
  street: string
  house: string
  apartment: string
  comment: string
}>

let uniqueCounter = 0

function uniqueHandle(prefix: string) {
  uniqueCounter += 1

  return `${prefix}-${Date.now()}-${uniqueCounter}`
}

function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
}

function adminHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
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

async function seedCheckoutProduct(
  container: MedusaContainer,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  input: {
    title: string
    sku: string
    stockedQuantity: number
    allowBackorder?: boolean
  }
): Promise<CheckoutProduct> {
  const {
    result: [category],
  } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [
        {
          name: `${input.title} Category`,
          handle: uniqueHandle("checkout-category"),
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
          handle: uniqueHandle("checkout-product"),
          description: "Integration checkout product.",
          status: ProductStatus.PUBLISHED,
          category_ids: [category.id],
          shipping_profile_id: baseline.shippingProfile.id,
          thumbnail: "https://example.test/checkout-product.jpg",
          metadata: {
            brand: "Checkout",
            characteristics: {
              Test: "true",
            },
          },
          options: [{ title: "Фасовка", values: ["1 л"] }],
          variants: [
            {
              title: "1 л",
              sku: input.sku,
              manage_inventory: true,
              allow_backorder: !!input.allowBackorder,
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
    fields: [
      "id",
      "variants.id",
      "variants.inventory_items.inventory_item_id",
    ],
    filters: { id: product.id },
  })
  const variant = products[0]?.variants?.[0]
  const inventoryItemId =
    variant?.inventory_items?.[0]?.inventory_item_id ?? null

  if (!variant?.id || !inventoryItemId) {
    throw new Error("Seeded checkout product is missing inventory linkage")
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
    throw new Error("Seeded checkout inventory level was not created")
  }

  return {
    variantId: variant.id,
    inventoryItemId,
    inventoryLevelId: levels[0].id,
  }
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

function checkoutBody(cartId: string, overrides: CheckoutBodyOverrides = {}) {
  return {
    cart_id: cartId,
    name: "Иван Петров",
    phone: "+7 (999) 123-45-67",
    email: "checkout-customer@test.com",
    city: "Москва",
    street: "Ленина",
    house: "10",
    apartment: "25",
    comment: "Позвонить перед доставкой",
    ...overrides,
  }
}

function initiatePaymentBody(orderId: string) {
  return {
    order_id: orderId,
    provider_id: "yookassa",
    return_url: "http://localhost:8000/checkout/payment/return",
  }
}

async function checkout(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  cartId: string,
  overrides: CheckoutBodyOverrides = {},
  config: Record<string, unknown> = {}
) {
  const { headers, ...requestConfig } = config as {
    headers?: Record<string, string>
  }

  return await api.post("/store/catalog/checkout", checkoutBody(cartId, overrides), {
    ...requestConfig,
    headers: storeHeaders(baseline, headers),
  })
}

async function checkoutOrderId(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  cartId: string,
  overrides: CheckoutBodyOverrides = {},
  config: Record<string, unknown> = {}
) {
  const response = await checkout(api, baseline, cartId, overrides, config)

  return response.data.order.id as string
}

async function listCustomersByEmail(container: MedusaContainer, email: string) {
  const { data } = await query(container).graph({
    entity: "customer",
    fields: ["id", "email"],
    filters: { email },
  })

  return data
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
    token: login.data.token as string,
  }
}

async function retrieveOrder(container: MedusaContainer, orderId: string) {
  const { data } = await query(container).graph(
    {
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "metadata",
        "customer.id",
        "customer.email",
        "shipping_address.first_name",
        "shipping_address.phone",
        "shipping_address.city",
        "shipping_address.address_1",
        "shipping_address.address_2",
      ],
      filters: { id: orderId },
    },
    { throwIfKeyNotFound: true }
  )

  return data[0]
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    let baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>
    let adminToken: string

    beforeAll(async () => {
      const container = getContainer()

      baseline = await seedCommerceBaseline(container)
      const paymentProviderConfigService = container.resolve(
        PAYMENT_PROVIDER_CONFIG_MODULE
      ) as PaymentProviderConfigModuleService
      await paymentProviderConfigService.setPaymentProviderAvailability({
        provider_id: "yookassa",
        store_id: baseline.store.id,
        region_id: baseline.region.id,
        is_enabled: true,
      })
      const axiosApi = api as TestApiClient & {
        defaults: { headers: { common: Record<string, string> } }
      }
      axiosApi.defaults.headers.common["x-publishable-api-key"] =
        publishableHeaders(baseline)["x-publishable-api-key"]
      adminToken = await createAdminToken(
        container,
        `${uniqueHandle("checkout-admin")}@test.com`,
        testEnv.JWT_SECRET
      )
    })

    describe("catalog checkout", () => {
      it("creates a cart from the empty storefront payload", async () => {
        const response = await api.post(
          "/store/carts",
          {},
          { headers: publishableHeaders(baseline) }
        )

        expect(response.status).toBe(200)
        expect(response.data.cart).toEqual(
          expect.objectContaining({
            currency_code: COMMERCE_BASELINE.currencyCode,
            region_id: baseline.region.id,
            sales_channel_id: baseline.salesChannel.id,
          })
        )
      })

      it("completes checkout with an Ozon test delivery option without calling Ozon", async () => {
        const container = getContainer()
        const product = await seedCheckoutProduct(container, baseline, {
          title: "Ozon checkout test product",
          sku: uniqueHandle("OZON-CHECKOUT").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
        const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as any
        const registry = container.resolve<ShippingProviderRegistryModuleService>(
          SHIPPING_PROVIDER_REGISTRY_MODULE
        )

        const storedOzonProviders = await fulfillmentModule.listFulfillmentProviders({
          id: OZON_PROVIDER_KEY,
        })
        if (!storedOzonProviders.length) {
          await fulfillmentModule.createFulfillmentProviders({
            id: OZON_PROVIDER_KEY,
            is_enabled: true,
          })
        }
        await registry.createShippingProviderVisibilities({
          provider_key: OZON_PROVIDER_KEY,
          is_visible: true,
        })
        await registry.saveProviderConfig({
          providerKey: OZON_PROVIDER_KEY,
          credentials: { client_id: "ozon-test-client", client_secret: "ozon-test-secret" },
          configuration: { sender: { city: "Москва", postal_code: "101000" } },
        })

        const ozonProvider = fulfillmentModule.fulfillmentProviderService_.retrieveProviderRegistration(
          OZON_PROVIDER_KEY
        ) as any
        const calculatePrice = jest
          .spyOn(ozonProvider, "calculatePrice")
          .mockResolvedValue({
            amount: 199,
            currency: "RUB",
            currency_code: "RUB",
            calculated_amount: 199,
            is_calculated_price_tax_inclusive: true,
            data: {
              tariffs: [
                {
                  code: "test-courier",
                  name: "Ozon test courier",
                  price: 199,
                  type: "courier",
                  currency: "RUB",
                  delivery_days_min: 1,
                  delivery_days_max: 2,
                  delivery_type: "courier",
                },
              ],
              selected_tariff: {
                code: "test-courier",
                name: "Ozon test courier",
                price: 199,
                type: "courier",
                currency: "RUB",
                delivery_days_min: 1,
                delivery_days_max: 2,
                delivery_type: "courier",
              },
            },
          } as any)
        const createFulfillment = jest
          .spyOn(ozonProvider, "createFulfillment")
          .mockResolvedValue({
            id: "ozon-test-fulfillment",
            tracking_number: "OZON-TEST-TRACK",
            status: "created",
            data: { test: true },
          })

        const option = await fulfillmentModule.createShippingOptions({
          name: uniqueHandle("ozon-checkout-test-option"),
          price_type: "calculated",
          provider_id: OZON_PROVIDER_KEY,
          service_zone_id: baseline.serviceZone.id,
          shipping_profile_id: baseline.shippingProfile.id,
          data: { delivery_type: "courier" },
          type: {
            label: "Ozon test courier",
            description: "Test-only Ozon checkout option",
            code: uniqueHandle("ozon-checkout-test").toLowerCase(),
          },
        })

        const options = await api.get(
          `/store/catalog/shipping/options?cart_id=${encodeURIComponent(cart.id)}`,
          { headers: storeHeaders(baseline) }
        )
        const normalized = options.data.shipping_options.find((item: any) =>
          item.id.startsWith(`${option.id}:courier:ozon:`)
        )
        expect(normalized).toEqual(
          expect.objectContaining({
            provider: "ozon",
            type: "courier",
            price: 199,
          })
        )

        await api.post(
          "/store/catalog/shipping/select",
          { cart_id: cart.id, option_id: normalized.id },
          { headers: storeHeaders(baseline) }
        )
        const response = await checkout(api, baseline, cart.id)

        expect(response.data.order).toEqual(expect.objectContaining({ id: expect.any(String) }))
        expect(calculatePrice).toHaveBeenCalled()
        expect(createFulfillment).not.toHaveBeenCalled()
      })

      it("selects CDEK without pricing an orphaned ApiShip option", async () => {
        const container = getContainer()
        const product = await seedCheckoutProduct(container, baseline, {
          title: "CDEK selection with orphaned ApiShip option",
          sku: uniqueHandle("CDEK-ORPHANED-APISHIP").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
        const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as any
        const orphanedProviderId = "apiship_apiship"

        const storedOrphanedProviders = await fulfillmentModule.listFulfillmentProviders({
          id: orphanedProviderId,
        })
        if (!storedOrphanedProviders.length) {
          await fulfillmentModule.createFulfillmentProviders({
            id: orphanedProviderId,
            is_enabled: false,
          })
        }
        await fulfillmentModule.createShippingOptions({
          name: uniqueHandle("orphaned-apiship-option"),
          price_type: "calculated",
          provider_id: orphanedProviderId,
          service_zone_id: baseline.serviceZone.id,
          shipping_profile_id: baseline.shippingProfile.id,
          type: {
            label: "Orphaned ApiShip",
            description: "Provider is deliberately absent from the container",
            code: uniqueHandle("orphaned-apiship").toLowerCase(),
          },
        })

        const cdekOption = await fulfillmentModule.createShippingOptions({
          name: uniqueHandle("cdek-courier-selection"),
          price_type: "calculated",
          provider_id: CDEK_PROVIDER_KEY,
          service_zone_id: baseline.serviceZone.id,
          shipping_profile_id: baseline.shippingProfile.id,
          data: { delivery_type: "courier" },
          type: {
            label: "CDEK courier",
            description: "Mocked CDEK courier option",
            code: uniqueHandle("cdek-courier-selection").toLowerCase(),
          },
        })
        const cdekProvider = fulfillmentModule.fulfillmentProviderService_
          .retrieveProviderRegistration(CDEK_PROVIDER_KEY) as any
        const calculatePrice = jest.spyOn(cdekProvider, "calculatePrice").mockResolvedValue({
          calculated_amount: 350,
          is_calculated_price_tax_inclusive: true,
          data: {
            tariff_codes: [
              {
                code: 137,
                name: "CDEK courier",
                delivery_sum: 350,
                period_min: 1,
                period_max: 2,
              },
            ],
          },
        })

        const response = await api.post(
          "/store/catalog/shipping/select",
          {
            cart_id: cart.id,
            option_id: `${cdekOption.id}:courier:cdek:137`,
          },
          { headers: storeHeaders(baseline) }
        )

        expect(response.status).toBe(200)
        expect(response.data).toEqual({ shipping_option_id: cdekOption.id })
        expect(calculatePrice).toHaveBeenCalled()
      })

      it("returns 409 when an Ozon shipping method has not been selected", async () => {
        const container = getContainer()
        const product = await seedCheckoutProduct(container, baseline, {
          title: "Checkout without selected Ozon shipping",
          sku: uniqueHandle("CHECKOUT-NO-OZON-SHIPPING").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)

        const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as any
        const storedOzonProviders = await fulfillmentModule.listFulfillmentProviders({
          id: OZON_PROVIDER_KEY,
        })
        if (!storedOzonProviders.length) {
          await fulfillmentModule.createFulfillmentProviders({
            id: OZON_PROVIDER_KEY,
            is_enabled: true,
          })
        }
        await fulfillmentModule.createShippingOptions({
          name: uniqueHandle("checkout-ozon-shipping"),
          price_type: "flat",
          provider_id: OZON_PROVIDER_KEY,
          service_zone_id: baseline.serviceZone.id,
          shipping_profile_id: baseline.shippingProfile.id,
          type: {
            label: "Ozon checkout fixture",
            description: "Requires an explicitly selected shipping method",
            code: uniqueHandle("checkout-ozon-shipping").toLowerCase(),
          },
          prices: [
            {
              amount: 500,
              currency_code: COMMERCE_BASELINE.currencyCode,
            },
          ],
        })

        await expect(checkout(api, baseline, cart.id)).rejects.toMatchObject({
          response: {
            status: 409,
            data: {
              type: "shipping",
              message: "Shipping method has not been selected",
            },
          },
        })

        const { data: orderCarts } = await query(container).graph({
          entity: "order_cart",
          fields: ["order_id", "cart_id"],
          filters: { cart_id: cart.id },
        })
        expect(orderCarts).toHaveLength(0)
      })

      it("initiates a YooKassa session with a fixed amount and redirect", async () => {
        const container = getContainer()
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T08 Online Payment Paint",
          sku: uniqueHandle("T08-ONLINE-PAYMENT").toUpperCase(),
          stockedQuantity: 2,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
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
        const { result: stalePaymentCollection } =
          await createPaymentCollectionForCartWorkflow(container).run({
            input: { cart_id: cart.id },
          })
        await paymentModule.updatePaymentCollections(
          stalePaymentCollection.id,
          { amount: 100 }
        )
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        const createPayment = jest.fn(async (payload: Record<string, any>) => ({
          id: "yookassa-payment-1",
          status: "pending",
          amount: payload.amount,
          confirmation: {
            type: "redirect",
            confirmation_url: "https://yookassa.test/checkout/payment-1",
          },
        }))
        function FakeYooCheckout() {
          return { constructor: FakeYooCheckout, createPayment }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const orderId = await checkoutOrderId(api, baseline, cart.id)

        const [initiated, repeated] = await Promise.all([
          api.post("/store/catalog/payment/initiate", {
            ...initiatePaymentBody(orderId),
          }),
          api.post("/store/catalog/payment/initiate", {
            ...initiatePaymentBody(orderId),
          }),
        ])

        expect(initiated.data.payment).toEqual({
          payment_collection_id: stalePaymentCollection.id,
          payment_session_id: expect.any(String),
          redirect_url: "https://yookassa.test/checkout/payment-1",
          status: "created",
        })
        expect(repeated.data.payment).toEqual({ ...initiated.data.payment, status: "active" })
        expect(createPayment).toHaveBeenCalledTimes(1)
        expect(createPayment).toHaveBeenCalledWith(
          expect.objectContaining({
            amount: { value: "1500.00", currency: "RUB" },
          }),
          expect.any(String)
        )
        const paymentSession = await paymentModule.retrievePaymentSession(
          initiated.data.payment.payment_session_id
        )
        const operations = container.resolve(
          PAYMENT_OPERATION_MODULE
        ) as PaymentOperationModuleService
        const paymentOperations = await operations.listPaymentOperations({
          idempotency_key: `payment:initiate:${orderId}:yookassa:0`,
        })

        expect(paymentSession.data).toEqual(
          expect.objectContaining({
            cart_id: cart.id,
            payment_operation_id: expect.any(String),
          })
        )
        expect(paymentOperations).toEqual([
          expect.objectContaining({
            id: paymentSession.data.payment_operation_id,
            type: "payment",
            order_id: orderId,
            cart_id: cart.id,
            provider_id: "yookassa",
          }),
        ])

        const { data: preparedCarts } = await query(container).graph({
          entity: "cart",
          fields: [
            "id",
            "email",
            "metadata",
            "shipping_address.first_name",
            "shipping_address.phone",
            "shipping_address.city",
            "shipping_address.address_1",
            "shipping_address.address_2",
            "shipping_methods.id",
          ],
          filters: { id: cart.id },
        })
        expect(preparedCarts[0]).toEqual(
          expect.objectContaining({
            email: "checkout-customer@test.com",
            metadata: expect.objectContaining({
              checkout_comment: "Позвонить перед доставкой",
            }),
            shipping_address: expect.objectContaining({
              first_name: "Иван Петров",
              phone: "+7 (999) 123-45-67",
              city: "Москва",
              address_1: "Ленина, 10",
              address_2: "25",
            }),
            shipping_methods: [expect.objectContaining({ id: expect.any(String) })],
          })
        )

        const { data: collectionsBeforePriceChange } = await query(container).graph({
          entity: "payment_collection",
          fields: ["id", "amount", "payment_sessions.id", "payment_sessions.amount"],
          filters: { id: initiated.data.payment.payment_collection_id },
        })
        const sessionAmount = JSON.stringify(
          collectionsBeforePriceChange[0]?.payment_sessions?.[0]?.amount
        )

        await updateProductVariantsWorkflow(container).run({
          input: {
            product_variants: [
              {
                id: product.variantId,
                prices: [
                  {
                    amount: 2500,
                    currency_code: COMMERCE_BASELINE.currencyCode,
                  },
                ],
              },
            ],
          },
        })

        const { data: collectionsAfterPriceChange } = await query(container).graph({
          entity: "payment_collection",
          fields: ["id", "amount", "payment_sessions.id", "payment_sessions.amount"],
          filters: { id: initiated.data.payment.payment_collection_id },
        })

        expect(
          JSON.stringify(collectionsAfterPriceChange[0]?.payment_sessions?.[0]?.amount)
        ).toBe(sessionAmount)
      })

      it("keeps the placed order when YooKassa initiation fails", async () => {
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
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T08 Failed Payment Paint",
          sku: uniqueHandle("T08-FAILED-PAYMENT").toUpperCase(),
          stockedQuantity: 2,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        function FailingYooCheckout() {
          return {
            constructor: FailingYooCheckout,
            createPayment: jest.fn(async () => {
              throw new Error("provider unavailable")
            }),
          }
        }
        provider.yooCheckout_ = { constructor: FailingYooCheckout as never }
        const orderId = await checkoutOrderId(api, baseline, cart.id)

        await expect(
          api.post("/store/catalog/payment/initiate", {
            ...initiatePaymentBody(orderId),
          })
        ).rejects.toMatchObject({
          response: {
            status: 500,
            data: {
              message: "Не удалось начать оплату заказа — попробуйте ещё раз.",
            },
          },
        })

        const { data: carts } = await query(container).graph({
          entity: "cart",
          fields: ["id", "items.id"],
          filters: { id: cart.id },
        })

        expect(carts[0]).toEqual(
          expect.objectContaining({ id: cart.id, items: expect.any(Array) })
        )
        expect(carts[0].items).toHaveLength(1)

        const { data: levels } = await query(container).graph({
          entity: "inventory_level",
          fields: ["id", "reserved_quantity"],
          filters: { id: product.inventoryLevelId },
        })
        expect(Number(levels[0]?.reserved_quantity)).toBe(1)
      })

      it("reuses a successful payment attempt without reserving inventory twice", async () => {
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
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T11 Idempotent Payment Paint",
          sku: uniqueHandle("T11-IDEMPOTENT-PAYMENT").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        const createPayment = jest.fn(async (payload: Record<string, any>) => ({
          id: "yookassa-payment-idempotent",
          status: "pending",
          amount: payload.amount,
          confirmation: {
            type: "redirect",
            confirmation_url: "https://yookassa.test/checkout/idempotent",
          },
        }))
        function FakeYooCheckout() {
          return { constructor: FakeYooCheckout, createPayment }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const orderId = await checkoutOrderId(api, baseline, cart.id)

        const first = await api.post(
          "/store/catalog/payment/initiate",
          initiatePaymentBody(orderId)
        )
        const retry = await api.post(
          "/store/catalog/payment/initiate",
          initiatePaymentBody(orderId)
        )

        expect(retry.data.payment).toEqual({
          ...first.data.payment,
          status: "active",
        })
        expect(createPayment).toHaveBeenCalledTimes(1)

        const { data: levels } = await query(container).graph({
          entity: "inventory_level",
          fields: ["id", "reserved_quantity"],
          filters: { id: product.inventoryLevelId },
        })
        expect(Number(levels[0]?.reserved_quantity)).toBe(1)
      })

      it("reuses the cart reservation when retrying a canceled payment session", async () => {
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
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T11 Canceled Payment Retry Paint",
          sku: uniqueHandle("T11-CANCELED-PAYMENT").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: {
            constructor: new (options: unknown) => unknown
            getPayment: (...args: unknown[]) => Promise<Record<string, any>>
          }
        }
        let paymentCounter = 0
        let providerPayment: Record<string, any> | null = null
        const createPayment = jest.fn(async (payload: Record<string, any>) => {
          paymentCounter += 1
          providerPayment = {
            id: `yookassa-payment-terminal-${paymentCounter}`,
            status: "pending",
            amount: payload.amount,
            confirmation: {
              type: "redirect",
              confirmation_url: `https://yookassa.test/checkout/terminal-${paymentCounter}`,
            },
          }
          return providerPayment
        })
        const getPayment = jest.fn(async () => ({
          ...providerPayment,
          status: "canceled",
        }))
        function FakeYooCheckout() {
          return { constructor: FakeYooCheckout, createPayment, getPayment }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const orderId = await checkoutOrderId(api, baseline, cart.id)

        const first = await api.post(
          "/store/catalog/payment/initiate",
          initiatePaymentBody(orderId)
        )
        const [firstSession] = await paymentModule.listPaymentSessions({
          id: first.data.payment.payment_session_id,
        })
        expect(firstSession.status).toBe("pending")

        const canceled = await api.post("/store/catalog/payment/status", {
          cart_id: cart.id,
        })
        expect(canceled.data.payment).toEqual({
          status: "failed",
          order_id: orderId,
        })
        expect(getPayment).toHaveBeenCalledTimes(1)

        const retry = await api.post(
          "/store/catalog/payment/initiate",
          initiatePaymentBody(orderId)
        )

        expect(retry.data.payment).toEqual({
          payment_collection_id: first.data.payment.payment_collection_id,
          payment_session_id: expect.any(String),
          redirect_url: "https://yookassa.test/checkout/terminal-2",
          status: "created",
        })
        expect(retry.data.payment.payment_session_id).not.toBe(
          first.data.payment.payment_session_id
        )
        expect(createPayment).toHaveBeenCalledTimes(2)

        const { data: levels } = await query(container).graph({
          entity: "inventory_level",
          fields: ["id", "reserved_quantity"],
          filters: { id: product.inventoryLevelId },
        })
        expect(Number(levels[0]?.reserved_quantity)).toBe(1)
      })

      it("keeps a guest order payable after the source cart expiration horizon", async () => {
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
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T20 Expired Payment Paint",
          sku: uniqueHandle("T20-EXPIRED-PAYMENT").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        let providerPayment: Record<string, any> | null = null
        const createPayment = jest.fn(async (payload: Record<string, any>) => {
          providerPayment = {
            id: "yookassa-payment-expired",
            status: "pending",
            amount: payload.amount,
            confirmation: {
              type: "redirect",
              confirmation_url: "https://yookassa.test/checkout/expired",
            },
          }

          return providerPayment
        })
        const getPayment = jest.fn(async () => providerPayment)
        function FakeYooCheckout() {
          return { constructor: FakeYooCheckout, createPayment, getPayment }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const orderId = await checkoutOrderId(api, baseline, cart.id)

        const initiated = await api.post(
          "/store/catalog/payment/initiate",
          initiatePaymentBody(orderId)
        )
        const beforeExpiration = new Date(Date.now() + 23 * 60 * 60 * 1000)
        const future = new Date(Date.now() + 25 * 60 * 60 * 1000)

        await expect(
          expireAbandonedCatalogPaymentCarts(container, beforeExpiration)
        ).resolves.toBe(0)
        await expect(
          expireAbandonedCatalogPaymentCarts(container, future)
        ).resolves.toBe(0)
        await expect(
          expireAbandonedCatalogPaymentCarts(
            container,
            new Date(future.getTime() + 60 * 60 * 1000)
          )
        ).resolves.toBe(0)
        const available = await api.post(
          "/store/catalog/payment/initiate",
          initiatePaymentBody(orderId)
        )

        const { data: carts } = await query(container).graph({
          entity: "cart",
          fields: ["id", "completed_at", "metadata"],
          filters: { id: cart.id },
        })
        const { data: orderCarts } = await query(container).graph({
          entity: "order_cart",
          fields: ["order_id", "cart_id"],
          filters: { cart_id: cart.id },
        })
        const paymentSession = await paymentModule.retrievePaymentSession(
          initiated.data.payment.payment_session_id
        )

        expect(available.status).toBe(200)
        expect(available.data.payment).toEqual({
          ...initiated.data.payment,
          status: "active",
        })
        expect(carts[0]?.completed_at).toEqual(expect.any(Date))
        expect(carts[0]?.metadata ?? {}).not.toHaveProperty(
          "catalog_payment_expired_at"
        )
        expect(orderCarts).toEqual([
          expect.objectContaining({ order_id: orderId, cart_id: cart.id }),
        ])
        expect(paymentSession.data.id).toBe("yookassa-payment-expired")
        expect(createPayment).toHaveBeenCalledTimes(1)
      })

      it("keeps a registered customer's cart payable after 24 hours", async () => {
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
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T20 Registered Cart Lifetime Paint",
          sku: uniqueHandle("T20-REGISTERED-CART-LIFETIME").toUpperCase(),
          stockedQuantity: 1,
        })
        const customerSession = await createCustomerSession(
          api,
          baseline,
          `${uniqueHandle("registered-cart-lifetime")}@test.com`
        )
        const cart = await createStoreCart(api, baseline, product.variantId)
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        const providerPayment = {
          id: "yookassa-payment-registered-cart",
          status: "pending",
          amount: { value: "0", currency: "RUB" },
          confirmation: {
            type: "redirect",
            confirmation_url:
              "https://yookassa.test/checkout/registered-cart",
          },
        }
        const createPayment = jest.fn(async (payload: Record<string, any>) => ({
          ...providerPayment,
          amount: payload.amount,
        }))
        const getPayment = jest.fn(async () => providerPayment)
        function FakeYooCheckout() {
          return { constructor: FakeYooCheckout, createPayment, getPayment }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const authConfig = {
          headers: bearer(customerSession.token),
        }
        const orderId = await checkoutOrderId(
          api,
          baseline,
          cart.id,
          {},
          authConfig
        )

        const initiated = await api.post(
          "/store/catalog/payment/initiate",
          initiatePaymentBody(orderId),
          authConfig
        )
        const future = new Date(Date.now() + 25 * 60 * 60 * 1000)

        await expect(
          expireAbandonedCatalogPaymentCarts(container, future)
        ).resolves.toBe(0)

        const available = await api.post(
          "/store/catalog/payment/initiate",
          initiatePaymentBody(orderId),
          authConfig
        )
        const { data: carts } = await query(container).graph({
          entity: "cart",
          fields: ["id", "customer_id", "metadata"],
          filters: { id: cart.id },
        })

        expect(available.status).toBe(200)
        expect(available.data.payment).toEqual({
          ...initiated.data.payment,
          status: "active",
        })
        expect(carts[0]).toEqual(
          expect.objectContaining({
            customer_id: customerSession.customer.id,
          })
        )
        expect(carts[0]?.metadata ?? {}).not.toHaveProperty(
          "catalog_payment_expired_at"
        )
        expect(createPayment).toHaveBeenCalledTimes(1)
      })

      it("does not expire a cart while a confirmed payment is being finalized", async () => {
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
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T20 Payment Expiration Race Paint",
          sku: uniqueHandle("T20-EXPIRATION-RACE").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        let providerPayment: Record<string, any> | null = null
        let signalStatusCheck!: () => void
        let releaseStatusCheck!: () => void
        const statusCheckStarted = new Promise<void>((resolve) => {
          signalStatusCheck = resolve
        })
        const statusCheckGate = new Promise<void>((resolve) => {
          releaseStatusCheck = resolve
        })
        const createPayment = jest.fn(async (payload: Record<string, any>) => {
          providerPayment = {
            id: "yookassa-payment-expiration-race",
            status: "pending",
            amount: payload.amount,
            confirmation: {
              type: "redirect",
              confirmation_url: "https://yookassa.test/checkout/expiration-race",
            },
          }
          return providerPayment
        })
        const getPayment = jest.fn(async () => {
          signalStatusCheck()
          await statusCheckGate

          return { ...providerPayment, status: "succeeded" }
        })
        function FakeYooCheckout() {
          return {
            constructor: FakeYooCheckout,
            createPayment,
            getPayment,
          }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const orderId = await checkoutOrderId(api, baseline, cart.id)

        await api.post("/store/catalog/payment/initiate", initiatePaymentBody(orderId))
        const finalization = api.post("/store/catalog/payment/status", {
          cart_id: cart.id,
        })
        await statusCheckStarted

        const expiration = expireAbandonedCatalogPaymentCarts(
          container,
          new Date(Date.now() + 25 * 60 * 60 * 1000)
        )
        releaseStatusCheck()

        const [finalized, expired] = await Promise.all([
          finalization,
          expiration,
        ])
        const { data: carts } = await query(container).graph({
          entity: "cart",
          fields: ["id", "completed_at", "metadata"],
          filters: { id: cart.id },
        })
        const { data: orderCarts } = await query(container).graph({
          entity: "order_cart",
          fields: ["order_id", "cart_id"],
          filters: { cart_id: cart.id },
        })

        expect(finalized.data.payment).toEqual({
          status: "succeeded",
          order_id: expect.any(String),
        })
        expect(expired).toBe(0)
        expect(carts[0]?.completed_at).not.toBeNull()
        expect(carts[0]?.metadata).not.toHaveProperty(
          "catalog_payment_expired_at"
        )
        expect(orderCarts).toEqual([
          expect.objectContaining({ order_id: finalized.data.payment.order_id }),
        ])
      })

      it("marks the existing order as paid after the source cart expiration horizon", async () => {
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
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T21 Late Confirmed Payment Paint",
          sku: uniqueHandle("T21-LATE-CONFIRMED").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        let providerPayment: Record<string, any> | null = null
        let paymentSucceeded = false
        const createPayment = jest.fn(async (payload: Record<string, any>) => {
          providerPayment = {
            id: "yookassa-payment-late-confirmed",
            status: "pending",
            amount: payload.amount,
            confirmation: {
              type: "redirect",
              confirmation_url: "https://yookassa.test/checkout/late-confirmed",
            },
          }

          return providerPayment
        })
        const getPayment = jest.fn(async () => ({
          ...providerPayment,
          status: paymentSucceeded ? "succeeded" : "pending",
        }))
        function FakeYooCheckout() {
          return {
            constructor: FakeYooCheckout,
            createPayment,
            getPayment,
          }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const orderId = await checkoutOrderId(api, baseline, cart.id)

        await api.post("/store/catalog/payment/initiate", initiatePaymentBody(orderId))
        const expiredAt = new Date(Date.now() + 25 * 60 * 60 * 1000)

        await expect(
          expireAbandonedCatalogPaymentCarts(container, expiredAt)
        ).resolves.toBe(0)
        paymentSucceeded = true

        const finalized = await api.post("/store/catalog/payment/status", {
          cart_id: cart.id,
        })
        const { data: carts } = await query(container).graph({
          entity: "cart",
          fields: ["id", "completed_at", "metadata"],
          filters: { id: cart.id },
        })
        const { data: orderCarts } = await query(container).graph({
          entity: "order_cart",
          fields: ["order_id", "cart_id"],
          filters: { cart_id: cart.id },
        })
        const accountOrders = await listAccountOrders(container, {
          id: "customer_not_linked",
          email: "checkout-customer@test.com",
        })
        const accountOrder = accountOrders.orders.find(
          (order) => order.id === finalized.data.payment.order_id
        )

        expect(finalized.data.payment).toEqual({
          status: "succeeded",
          order_id: orderId,
        })
        expect(carts[0]?.completed_at).toEqual(expect.any(Date))
        expect(carts[0]?.metadata ?? {}).not.toHaveProperty(
          "catalog_payment_expired_at"
        )
        expect(orderCarts).toEqual([
          expect.objectContaining({ order_id: orderId, cart_id: cart.id }),
        ])
        expect(
          (accountOrder as unknown as Record<string, unknown>)?.payment_status
        ).toBe("paid")
      })

      it("reserves the last unit while placing the order and only initiates its payment", async () => {
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
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T11 Last Unit Payment Paint",
          sku: uniqueHandle("T11-LAST-UNIT-PAYMENT").toUpperCase(),
          stockedQuantity: 1,
        })
        const [firstCart, secondCart] = await Promise.all([
          createStoreCart(api, baseline, product.variantId),
          createStoreCart(api, baseline, product.variantId),
        ])
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        let paymentCounter = 0
        const createPayment = jest.fn(async (payload: Record<string, any>) => {
          paymentCounter += 1
          return {
            id: `yookassa-payment-${paymentCounter}`,
            status: "pending",
            amount: payload.amount,
            confirmation: {
              type: "redirect",
              confirmation_url: `https://yookassa.test/checkout/payment-${paymentCounter}`,
            },
          }
        })
        function FakeYooCheckout() {
          return { constructor: FakeYooCheckout, createPayment }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }

        const checkoutAttempts = await Promise.allSettled([
          checkoutOrderId(api, baseline, firstCart.id),
          checkoutOrderId(api, baseline, secondCart.id),
        ])
        const successfulCheckout = checkoutAttempts.find(
          (attempt): attempt is PromiseFulfilledResult<string> =>
            attempt.status === "fulfilled"
        )

        expect(successfulCheckout).toBeDefined()
        expect(checkoutAttempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1)
        expect(checkoutAttempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1)

        await api.post(
          "/store/catalog/payment/initiate",
          initiatePaymentBody(successfulCheckout!.value)
        )
        expect(createPayment).toHaveBeenCalledTimes(1)

        const { data: levels } = await query(container).graph({
          entity: "inventory_level",
          fields: ["id", "stocked_quantity", "reserved_quantity"],
          filters: { id: product.inventoryLevelId },
        })
        expect(Number(levels[0]?.stocked_quantity)).toBe(1)
        expect(Number(levels[0]?.reserved_quantity)).toBe(1)
      })

      it("creates one paid order and transfers the existing cart reservation", async () => {
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
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T13 Paid Order Paint",
          sku: uniqueHandle("T13-PAID-ORDER").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        let providerPayment: Record<string, any> | null = null
        const createPayment = jest.fn(async (payload: Record<string, any>) => {
          providerPayment = {
            id: "yookassa-payment-paid-order",
            status: "pending",
            amount: payload.amount,
            metadata: payload.metadata,
            confirmation: {
              type: "redirect",
              confirmation_url: "https://yookassa.test/checkout/paid-order",
            },
          }
          return providerPayment
        })
        let paymentSucceeded = false
        const getPayment = jest.fn(async () => ({
          ...providerPayment,
          status: paymentSucceeded ? "succeeded" : "pending",
        }))
        const createRefund = jest.fn(async (payload: Record<string, any>) => {
          if (providerPayment) {
            providerPayment.refunded_amount = {
              value: "1500.00",
              currency: "RUB",
            }
          }

          return {
            id: "yookassa-refund-paid-order",
            status: "succeeded",
            ...payload,
          }
        })
        function FakeYooCheckout() {
          return {
            constructor: FakeYooCheckout,
            createPayment,
            getPayment,
            createRefund,
          }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const placedOrderId = await checkoutOrderId(api, baseline, cart.id)

        await api.post(
          "/store/catalog/payment/initiate",
          initiatePaymentBody(placedOrderId)
        )
        const pending = await api.post("/store/catalog/payment/status", {
          cart_id: cart.id,
        })

        expect(pending.data.payment).toEqual({
          status: "pending",
          order_id: placedOrderId,
        })

        paymentSucceeded = true

        const attempts = await Promise.all([
          api.post("/store/catalog/payment/status", { cart_id: cart.id }),
          api.post("/store/catalog/payment/status", { cart_id: cart.id }),
        ])
        const results = attempts.map((attempt) => attempt.data.payment)
        expect(results.every((result) => result.status === "succeeded" || result.status === "pending")).toBe(true)
        const successful = results.find((result) => result.status === "succeeded")
        expect(successful?.order_id).toBe(placedOrderId)
        expect(results.every((result) => result.order_id === placedOrderId || (result.status === "pending" && result.order_id === null))).toBe(true)
        const orderIds = [placedOrderId]
        // One pending check, one successful check, then standard Medusa
        // authorization persists the captured payment using the provider API.
        expect(getPayment).toHaveBeenCalledTimes(3)

        const orderId = orderIds[0]
        const { data: orderCarts } = await query(container).graph({
          entity: "order_cart",
          fields: ["order_id", "cart_id"],
          filters: { cart_id: cart.id },
        })
        const { data: orders } = await query(container).graph({
          entity: "order",
          fields: [
            "id",
            "items.id",
            "items.variant_id",
            "transactions.id",
            "transactions.reference",
            "transactions.reference_id",
          ],
          filters: { id: orderId },
        })
        const { data: orderPayments } = await query(container).graph({
          entity: "order_payment_collection",
          fields: ["order_id", "payment_collection_id"],
          filters: { order_id: orderId },
        })
        const { data: reservations } = await query(container).graph({
          entity: "reservation_item",
          fields: ["id", "line_item_id", "inventory_item_id", "quantity"],
          filters: { inventory_item_id: product.inventoryItemId },
        })
        const { data: levels } = await query(container).graph({
          entity: "inventory_level",
          fields: ["id", "reserved_quantity"],
          filters: { id: product.inventoryLevelId },
        })
        const { data: carts } = await query(container).graph({
          entity: "cart",
          fields: ["id", "completed_at", "payment_collection.status"],
          filters: { id: cart.id },
        })

        expect(orderCarts).toEqual([{ order_id: orderId, cart_id: cart.id }])
        expect(orderPayments).toHaveLength(1)
        expect(orders[0]?.items).toHaveLength(1)
        expect(orders[0]?.transactions).toEqual([
          expect.objectContaining({
            reference: "capture",
            reference_id: expect.any(String),
          }),
        ])
        expect(reservations).toHaveLength(1)
        expect(reservations[0]?.line_item_id).toBe(orders[0]?.items?.[0]?.id)
        expect(Number(levels[0]?.reserved_quantity)).toBe(1)
        expect(carts[0]?.completed_at).toBeTruthy()
        expect(carts[0]?.payment_collection?.status).toBe("completed")

        const accountOrders = await listAccountOrders(container, {
          id: "customer_not_linked",
          email: "checkout-customer@test.com",
        })
        const accountOrder = accountOrders.orders.find((order) => order.id === orderId)

        expect(
          (accountOrder as unknown as Record<string, unknown>)?.payment_status
        ).toBe("paid")

        const customerSession = await createCustomerSession(
          api,
          baseline,
          "checkout-customer@test.com"
        )
        const canceled = await api.post(
          `/store/account/orders/${orderId}/cancel`,
          {},
          {
            headers: storeHeaders(
              baseline,
              bearer(customerSession.token)
            ),
          }
        )

        expect(canceled.data.order).toEqual(
          expect.objectContaining({
            id: orderId,
            status: "canceled",
          })
        )
        expect(["refund_pending", "refunded"]).toContain(
          canceled.data.order.payment_status
        )

        for (let attempt = 0; attempt < 50 && !createRefund.mock.calls.length; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }

        expect(createRefund).toHaveBeenCalledTimes(1)
        expect(createRefund).toHaveBeenCalledWith(
          expect.objectContaining({
            payment_id: "yookassa-payment-paid-order",
          }),
          expect.any(String)
        )

        let refundedAccountOrder: Awaited<
          ReturnType<typeof listAccountOrders>
        >["orders"][number] | undefined
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const refundedAccountOrders = await listAccountOrders(container, {
            id: customerSession.customer.id,
            email: customerSession.customer.email,
          })
          refundedAccountOrder = refundedAccountOrders.orders.find(
            (order) => order.id === orderId
          )
          if (refundedAccountOrder?.payment_status === "refunded") {
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }

        expect(refundedAccountOrder?.payment_status).toBe("refunded")

        let refundedOrders: Array<{
          id: string
          metadata?: Record<string, unknown> | null
        }> = []
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const result = await query(container).graph({
            entity: "order",
            fields: ["id", "metadata"],
            filters: { id: orderId },
          })
          refundedOrders = result.data as typeof refundedOrders
          if (refundedOrders[0]?.metadata?.catalog_refund_status === "refunded") {
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(refundedOrders[0]?.metadata).toEqual(
          expect.objectContaining({
            catalog_refund_status: "refunded",
            catalog_refund_error: null,
          })
        )

        const canceledAgain = await api.post(
          `/store/account/orders/${orderId}/cancel`,
          {},
          {
            headers: storeHeaders(
              baseline,
              bearer(customerSession.token)
            ),
          }
        )

        expect(canceledAgain.data.order).toEqual(
          expect.objectContaining({
            id: orderId,
            status: "canceled",
            payment_status: "refunded",
          })
        )
        await new Promise((resolve) => setTimeout(resolve, 25))
        expect(createRefund).toHaveBeenCalledTimes(1)
      })

      it("keeps a canceled-payment cart available for another attempt", async () => {
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
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T13 Canceled Order Paint",
          sku: uniqueHandle("T13-CANCELED-ORDER").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const provider = paymentModule.paymentProviderService_.retrieveProvider(
          "pp_yookassa_yookassa"
        ) as {
          yooCheckout_: { constructor: new (options: unknown) => unknown }
        }
        let providerPayment: Record<string, any> | null = null
        let providerPaymentCounter = 0
        const createPayment = jest.fn(async (payload: Record<string, any>) => {
          providerPaymentCounter += 1
          providerPayment = {
            id: `yookassa-payment-canceled-${providerPaymentCounter}`,
            status: "pending",
            amount: payload.amount,
            metadata: payload.metadata,
            confirmation: {
              type: "redirect",
              confirmation_url: `https://yookassa.test/checkout/canceled-${providerPaymentCounter}`,
            },
          }
          return providerPayment
        })
        const getPayment = jest.fn(async () => ({
          ...providerPayment,
          status: "canceled",
        }))
        function FakeYooCheckout() {
          return { constructor: FakeYooCheckout, createPayment, getPayment }
        }
        provider.yooCheckout_ = { constructor: FakeYooCheckout as never }
        const orderId = await checkoutOrderId(api, baseline, cart.id)

        await api.post("/store/catalog/payment/initiate", initiatePaymentBody(orderId))
        const status = await api.post("/store/catalog/payment/status", {
          cart_id: cart.id,
        })

        expect(status.data.payment).toEqual({
          status: "failed",
          order_id: orderId,
        })

        await api.post("/store/catalog/payment/initiate", initiatePaymentBody(orderId))

        const { data: orderCarts } = await query(container).graph({
          entity: "order_cart",
          fields: ["order_id", "cart_id"],
          filters: { cart_id: cart.id },
        })
        const { data: carts } = await query(container).graph({
          entity: "cart",
          fields: ["id", "completed_at", "items.id"],
          filters: { id: cart.id },
        })
        const { data: reservations } = await query(container).graph({
          entity: "reservation_item",
          fields: ["line_item_id"],
          filters: { inventory_item_id: product.inventoryItemId },
        })

        expect(orderCarts).toEqual([expect.objectContaining({ order_id: orderId, cart_id: cart.id })])
        expect(carts[0]?.completed_at).toBeTruthy()
        expect(carts[0]?.items).toHaveLength(1)
        expect(reservations).toHaveLength(1)
        const { data: retryOrders } = await query(container).graph({
          entity: "order", fields: ["id", "items.id"], filters: { id: orderId },
        })
        expect(reservations[0]?.line_item_id).toBe(retryOrders[0]?.items?.[0]?.id)
        expect(createPayment).toHaveBeenCalledTimes(2)
      })

      it("rejects admin Orders API requests without authentication", async () => {
        await expect(api.get("/admin/orders")).rejects.toMatchObject({
          response: { status: 401 },
        })
      })

      it("rejects invalid checkout form payloads before placing an order", async () => {
        await expect(
          api.post(
            "/store/catalog/checkout",
            checkoutBody("cart_missing", {
              phone: "invalid phone",
              email: "not-an-email",
            })
          )
        ).rejects.toMatchObject({
          response: { status: 400 },
        })
      })

      it("places storefront carts as admin-visible orders and reuses the checkout email customer", async () => {
        const container = getContainer()
        const email = `${uniqueHandle("checkout-customer")}@test.com`
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T21 Checkout Paint",
          sku: uniqueHandle("T21-CHECKOUT-PAINT").toUpperCase(),
          stockedQuantity: 3,
        })
        const firstCart = await createStoreCart(api, baseline, product.variantId)
        const firstCheckout = await checkout(api, baseline, firstCart.id, { email })

        expect(firstCheckout.status).toBe(200)
        expect(firstCheckout.data).toEqual({
          type: "order",
          order: {
            id: expect.any(String),
            display_id: expect.any(Number),
          },
        })

        const firstOrder = await retrieveOrder(
          container,
          firstCheckout.data.order.id
        )
        const customersAfterFirstOrder = await listCustomersByEmail(
          container,
          email
        )

        expect(customersAfterFirstOrder).toHaveLength(1)
        const accountOrders = await listAccountOrders(container, {
          id: customersAfterFirstOrder[0].id,
          email,
        })
        const accountOrder = accountOrders.orders.find(
          (order) => order.id === firstCheckout.data.order.id
        )

        expect(
          (accountOrder as unknown as Record<string, unknown>)?.payment_status
        ).toBeNull()
        expect(firstOrder).toEqual(
          expect.objectContaining({
            id: firstCheckout.data.order.id,
            email,
            customer: expect.objectContaining({
              id: customersAfterFirstOrder[0].id,
              email,
            }),
          })
        )

        const adminOrder = await api.get(`/admin/orders/${firstOrder.id}`, {
          headers: adminHeaders(adminToken),
          params: {
            fields:
              "id,email,metadata,*shipping_address,*items,*items.detail,*items.variant",
          },
        })
        const adminOrderItem = adminOrder.data.order.items.find(
          (item: AdminOrderItem) =>
            item.variant_id === product.variantId ||
            item.variant?.id === product.variantId
        )

        expect(adminOrder.status).toBe(200)
        expect(adminOrder.data.order.id).toBe(firstOrder.id)
        expect(adminOrder.data.order.email).toBe(email)
        expect(adminOrder.data.order.metadata).toEqual(
          expect.objectContaining({
            checkout_comment: "Позвонить перед доставкой",
            checkout_contact_name: "Иван Петров",
            checkout_contact_phone: "+7 (999) 123-45-67",
            checkout_address_city: "Москва",
            checkout_address_street: "Ленина",
            checkout_address_house: "10",
            checkout_address_apartment: "25",
          })
        )
        expect(adminOrder.data.order.shipping_address).toEqual(
          expect.objectContaining({
            first_name: "Иван Петров",
            phone: "+7 (999) 123-45-67",
            city: "Москва",
            address_1: "Ленина, 10",
            address_2: "25",
          })
        )
        expect(adminOrderItem).toEqual(
          expect.objectContaining({
            variant_id: product.variantId,
          })
        )
        expect(
          Number(
            adminOrderItem?.detail?.quantity ??
              adminOrderItem?.quantity ??
              adminOrderItem?.raw_quantity
          )
        ).toBe(1)

        const secondCart = await createStoreCart(api, baseline, product.variantId)
        const secondCheckout = await checkout(api, baseline, secondCart.id, { email })
        const secondOrder = await retrieveOrder(
          container,
          secondCheckout.data.order.id
        )
        const customersAfterSecondOrder = await listCustomersByEmail(
          container,
          email
        )

        expect(customersAfterSecondOrder).toHaveLength(1)
        expect(secondOrder.customer.id).toBe(customersAfterFirstOrder[0].id)

        const customerSession = await createCustomerSession(api, baseline, email)
        const canceled = await api.post(
          `/store/account/orders/${firstOrder.id}/cancel`,
          {},
          {
            headers: storeHeaders(
              baseline,
              bearer(customerSession.token)
            ),
          }
        )

        expect(canceled.data.order).toEqual(
          expect.objectContaining({
            id: firstOrder.id,
            status: "canceled",
            payment_status: null,
          })
        )

        const otherSession = await createCustomerSession(
          api,
          baseline,
          `${uniqueHandle("cancel-other-customer")}@test.com`
        )

        await expect(
          api.post(
            `/store/account/orders/${secondOrder.id}/cancel`,
            {},
            {
              headers: storeHeaders(
                baseline,
                bearer(otherSession.token)
              ),
            }
          )
        ).rejects.toMatchObject({ response: { status: 404 } })

        const { data: fulfillableOrders } = await query(container).graph({
          entity: "order",
          fields: ["id", "items.id", "items.quantity"],
          filters: { id: secondOrder.id },
        })
        const fulfillableItem = fulfillableOrders[0]?.items?.[0]

        await createOrderFulfillmentWorkflow(container).run({
          input: {
            order_id: secondOrder.id,
            items: [
              {
                id: fulfillableItem.id,
                quantity: 1,
              },
            ],
          },
        })

        await expect(
          api.post(
            `/store/account/orders/${secondOrder.id}/cancel`,
            {},
            {
              headers: storeHeaders(
                baseline,
                bearer(customerSession.token)
              ),
            }
          )
        ).rejects.toMatchObject({ response: { status: 400 } })
      })

      it("shows same-email guest orders in account history and protects order details", async () => {
        const container = getContainer()
        const email = `${uniqueHandle("account-history")}@test.com`
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T23 Account History Paint",
          sku: uniqueHandle("T23-HISTORY-PAINT").toUpperCase(),
          stockedQuantity: 4,
        })
        const guestCart = await createStoreCart(api, baseline, product.variantId)
        const guestCheckout = await checkout(api, baseline, guestCart.id, { email })

        expect(guestCheckout.status).toBe(200)

        const customerSession = await createCustomerSession(api, baseline, email)
        const accountHeaders = storeHeaders(baseline, {
          Cookie: customerSession.cookie,
        })
        const firstHistory = await api.get("/store/account/orders", {
          headers: accountHeaders,
        })
        const firstHistoryIds = firstHistory.data.orders.map(
          (order: { id: string }) => order.id
        )

        expect(firstHistory.status).toBe(200)
        expect(firstHistoryIds).toContain(guestCheckout.data.order.id)

        const guestDetail = await api.get(
          `/store/account/orders/${guestCheckout.data.order.id}`,
          { headers: accountHeaders }
        )

        expect(guestDetail.status).toBe(200)
        expect(guestDetail.data.order).toEqual(
          expect.objectContaining({
            id: guestCheckout.data.order.id,
            email,
            fulfillment_status: expect.any(String),
            payment_status: null,
            contact: expect.objectContaining({
              name: "Иван Петров",
              phone: "+7 (999) 123-45-67",
              email,
            }),
            address: expect.objectContaining({
              city: "Москва",
              address_1: "Ленина, 10",
              address_2: "25",
            }),
          })
        )
        expect(guestDetail.data.order.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              quantity: 1,
              article: product.variantId ? expect.any(String) : null,
            }),
          ])
        )
        expect(guestDetail.data.order).not.toHaveProperty("payment_collections")
        expect(guestDetail.data.order).not.toHaveProperty("payment_methods")
        expect(guestDetail.data.order).not.toHaveProperty("shipping_methods")

        const authenticatedCart = await createStoreCart(
          api,
          baseline,
          product.variantId
        )
        const authenticatedCheckout = await checkout(
          api,
          baseline,
          authenticatedCart.id,
          { email },
          { headers: { Cookie: customerSession.cookie } }
        )
        const authenticatedOrder = await retrieveOrder(
          container,
          authenticatedCheckout.data.order.id
        )

        expect(authenticatedOrder.customer.id).toBe(customerSession.customer.id)

        const secondHistory = await api.get("/store/account/orders", {
          headers: accountHeaders,
        })
        const secondHistoryIds = secondHistory.data.orders.map(
          (order: { id: string }) => order.id
        )

        expect(secondHistoryIds).toEqual(
          expect.arrayContaining([
            guestCheckout.data.order.id,
            authenticatedCheckout.data.order.id,
          ])
        )

        const otherSession = await createCustomerSession(
          api,
          baseline,
          `${uniqueHandle("account-history-other")}@test.com`
        )

        await expect(
          api.get(`/store/account/orders/${guestCheckout.data.order.id}`, {
            headers: storeHeaders(baseline, { Cookie: otherSession.cookie }),
          })
        ).rejects.toMatchObject({
          response: { status: 404 },
        })
      })

      it("does not leak one customer's orders into another customer's order list", async () => {
        const product = await seedCheckoutProduct(getContainer(), baseline, {
          title: "T11 Isolation Paint",
          sku: uniqueHandle("T11-ISOLATION-PAINT").toUpperCase(),
          stockedQuantity: 2,
        })
        const ownerSession = await createCustomerSession(
          api,
          baseline,
          `${uniqueHandle("t11-owner")}@test.com`
        )
        const ownerCart = await createStoreCart(api, baseline, product.variantId)
        const ownerCheckout = await checkout(
          api,
          baseline,
          ownerCart.id,
          { email: ownerSession.customer.email },
          { headers: { Cookie: ownerSession.cookie } }
        )
        expect(ownerCheckout.status).toBe(200)

        const otherSession = await createCustomerSession(
          api,
          baseline,
          `${uniqueHandle("t11-other")}@test.com`
        )
        const otherList = await api.get("/store/account/orders", {
          headers: storeHeaders(baseline, { Cookie: otherSession.cookie }),
        })
        const otherIds = otherList.data.orders.map((order: { id: string }) => order.id)

        expect(otherIds).not.toContain(ownerCheckout.data.order.id)

        await expect(
          api.get(`/store/account/orders/${ownerCheckout.data.order.id}`, {
            headers: storeHeaders(baseline, { Cookie: otherSession.cookie }),
          })
        ).rejects.toMatchObject({ response: { status: 404 } })
      })

      it("puts a canceled order in the history bucket even though it was never fulfilled", async () => {
        const product = await seedCheckoutProduct(getContainer(), baseline, {
          title: "T11 Cancel Priority Paint",
          sku: uniqueHandle("T11-CANCEL-PRIORITY").toUpperCase(),
          stockedQuantity: 2,
        })
        const session = await createCustomerSession(
          api,
          baseline,
          `${uniqueHandle("t11-cancel")}@test.com`
        )
        const cart = await createStoreCart(api, baseline, product.variantId)
        const placed = await checkout(
          api,
          baseline,
          cart.id,
          { email: session.customer.email },
          { headers: { Cookie: session.cookie } }
        )
        expect(placed.status).toBe(200)

        const accountHeaders = storeHeaders(baseline, { Cookie: session.cookie })

        const beforeCancel = await api.get(
          "/store/account/orders?filter=in_progress",
          { headers: accountHeaders }
        )
        expect(
          beforeCancel.data.orders.map((order: { id: string }) => order.id)
        ).toContain(placed.data.order.id)

        const cancel = await api.post(
          `/admin/orders/${placed.data.order.id}/cancel`,
          {},
          { headers: adminHeaders(adminToken) }
        )
        expect(cancel.status).toBe(200)

        const afterCancelInProgress = await api.get(
          "/store/account/orders?filter=in_progress",
          { headers: accountHeaders }
        )
        expect(
          afterCancelInProgress.data.orders.map((order: { id: string }) => order.id)
        ).not.toContain(placed.data.order.id)

        const afterCancelHistory = await api.get(
          "/store/account/orders?filter=history",
          { headers: accountHeaders }
        )
        expect(
          afterCancelHistory.data.orders.map((order: { id: string }) => order.id)
        ).toContain(placed.data.order.id)
      })

      it("rejects checkout when the last unit was bought before order placement", async () => {
        const container = getContainer()
        const product = await seedCheckoutProduct(container, baseline, {
          title: "T21 Last Unit Paint",
          sku: uniqueHandle("T21-LAST-UNIT").toUpperCase(),
          stockedQuantity: 1,
        })
        const cart = await createStoreCart(api, baseline, product.variantId)

        await updateInventoryLevelsWorkflow(container).run({
          input: {
            updates: [
              {
                id: product.inventoryLevelId,
                inventory_item_id: product.inventoryItemId,
                location_id: baseline.stockLocation.id,
                stocked_quantity: 0,
              },
            ],
          },
        })

        await expect(checkout(api, baseline, cart.id)).rejects.toMatchObject({
          response: {
            status: 409,
            data: {
              type: "cart",
              items: expect.arrayContaining([
                expect.objectContaining({
                  variant_id: product.variantId,
                  quantity: 1,
                  purchasable: false,
                  available_quantity: 0,
                }),
              ]),
            },
          },
        })
      })
    })
  },
})
