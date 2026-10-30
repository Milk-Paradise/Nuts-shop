import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  batchLinksWorkflow,
  createOrderFulfillmentWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createShippingOptionsWorkflow,
} from "@medusajs/medusa/core-flows"

import { CdekClient } from "../../src/modules/shipping-provider-registry/cdek-client"
import CdekFulfillmentService from "../../src/providers/fulfillment-cdek/service"
import {
  CDEK_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../src/modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../src/modules/shipping-provider-registry/service"
import { cdekWebhookSignature } from "../../src/workflows/process-cdek-webhook"
import {
  COMMERCE_BASELINE,
  seedCommerceBaseline,
} from "../../src/scripts/seed-commerce"
import { createAdminToken } from "./test-helpers/admin-token"

const testEnv = {
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  STORE_CORS: process.env.STORE_CORS ?? "http://localhost:8000,http://localhost:9000",
  ADMIN_CORS: process.env.ADMIN_CORS ?? "http://localhost:9000,http://localhost:7001",
  AUTH_CORS: process.env.AUTH_CORS ??
    "http://localhost:9000,http://localhost:7001,http://localhost:8000",
  JWT_SECRET: process.env.JWT_SECRET ?? "test-jwt-secret",
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? "test-cookie-secret",
  AUTH_MFA_ENCRYPTION_KEY:
    process.env.AUTH_MFA_ENCRYPTION_KEY ?? "test-mfa-encryption-key",
  SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY:
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY ??
    Buffer.alloc(32, 13).toString("base64"),
}

type TestApiClient = {
  post(path: string, body?: Record<string, unknown>, config?: Record<string, unknown>): Promise<any>
}

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }): Promise<{ data: Record<string, any>[] }>
}

let uniqueCounter = 0

function uniqueValue(prefix: string) {
  uniqueCounter += 1
  return `${prefix}-${Date.now()}-${uniqueCounter}`
}

function query(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
}

function storeHeaders(
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  extra: Record<string, string> = {}
) {
  const token = baseline.publishableApiKey.token
  if (typeof token !== "string" || !token.startsWith("pk_")) {
    throw new Error("Seeded publishable API key did not expose a raw token")
  }
  return { "x-publishable-api-key": token, ...extra }
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function createCustomerSession(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  email: string
) {
  const password = "supersecret1"
  const registration = await api.post("/auth/customer/emailpass/register", { email, password })
  const customer = await api.post(
    "/store/customers",
    { email },
    { headers: storeHeaders(baseline, authHeaders(registration.data.token)) }
  )
  const login = await api.post("/auth/customer/emailpass", { email, password })
  return { customer: customer.data.customer, token: login.data.token as string }
}

async function seedProduct(
  container: MedusaContainer,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>
) {
  const { result: [category] } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [{
        name: uniqueValue("CDEK lifecycle category"),
        handle: uniqueValue("cdek-lifecycle-category").toLowerCase(),
        is_active: true,
      }],
    },
  })
  const { result: [product] } = await createProductsWorkflow(container).run({
    input: {
      products: [{
        title: uniqueValue("CDEK lifecycle paint"),
        handle: uniqueValue("cdek-lifecycle-paint").toLowerCase(),
        status: ProductStatus.PUBLISHED,
        category_ids: [category.id],
        shipping_profile_id: baseline.shippingProfile.id,
        options: [{ title: "Volume", values: ["1L"] }],
        variants: [{
          title: "1L",
          sku: uniqueValue("CDEK-LIFECYCLE").toUpperCase(),
          manage_inventory: true,
          options: { Volume: "1L" },
          prices: [{ amount: 1500, currency_code: COMMERCE_BASELINE.currencyCode }],
        }],
        sales_channels: [{ id: baseline.salesChannel.id }],
      }],
    },
  })
  const { data } = await query(container).graph({
    entity: "product",
    fields: ["variants.id", "variants.inventory_items.inventory_item_id"],
    filters: { id: product.id },
  })
  const variant = data[0]?.variants?.[0]
  const inventoryItemId = variant?.inventory_items?.[0]?.inventory_item_id
  if (!variant?.id || !inventoryItemId) throw new Error("Missing seeded inventory linkage")
  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: [{
        inventory_item_id: inventoryItemId,
        location_id: baseline.stockLocation.id,
        stocked_quantity: 20,
      }],
    },
  })
  return variant.id as string
}

async function placeOrder(
  api: TestApiClient,
  baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>,
  variantId: string,
  email: string
) {
  const cart = await api.post(
    "/store/carts",
    {
      region_id: baseline.region.id,
      sales_channel_id: baseline.salesChannel.id,
      items: [{ variant_id: variantId, quantity: 1 }],
    },
    { headers: storeHeaders(baseline) }
  )
  const checkout = await api.post(
    "/store/catalog/checkout",
    {
      cart_id: cart.data.cart.id,
      name: "CDEK Integration Buyer",
      phone: "+79990000001",
      email,
      city: "Тула",
      street: "Ленина",
      house: "1",
      apartment: "2",
      comment: "CDEK lifecycle integration test",
    },
    { headers: storeHeaders(baseline) }
  )
  return checkout.data.order.id as string
}

async function attachCdekShipment(
  container: MedusaContainer,
  orderId: string,
  status: "placed" | "preparing" | "in_transit" | "delivered" = "placed"
) {
  const { data } = await query(container).graph({
    entity: "order",
    fields: [
      "items.id",
      "items.quantity",
      "items.detail.quantity",
      "shipping_methods.id",
      "shipping_methods.shipping_option_id",
    ],
    filters: { id: orderId },
  })
  const order = data[0]
  const method = order.shipping_methods[0]
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as any
  const sourceOption = await fulfillmentModule.retrieveShippingOption(
    method.shipping_option_id
  )
  const { data: serviceZones } = await query(container).graph({
    entity: "service_zone",
    fields: ["fulfillment_set.location.id"],
    filters: { id: sourceOption.service_zone_id },
  })
  const locationId = serviceZones[0]?.fulfillment_set?.location?.id
  if (!locationId) throw new Error("Missing stock location for CDEK fixture")
  const { data: providerLinks } = await query(container).graph({
    entity: "location_fulfillment_provider",
    fields: ["stock_location_id", "fulfillment_provider_id"],
    filters: {
      stock_location_id: locationId,
      fulfillment_provider_id: CDEK_PROVIDER_KEY,
    },
  })
  if (!providerLinks.length) {
    await batchLinksWorkflow(container).run({
      input: {
        create: [{
          [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
          [Modules.FULFILLMENT]: { fulfillment_provider_id: CDEK_PROVIDER_KEY },
        }],
      },
    })
  }
  const existingOptions = await fulfillmentModule.listShippingOptions({
    provider_id: CDEK_PROVIDER_KEY,
    service_zone_id: sourceOption.service_zone_id,
    shipping_profile_id: sourceOption.shipping_profile_id,
  })
  let cdekOption = existingOptions[0]
  if (!cdekOption) {
    const { result: [created] } = await createShippingOptionsWorkflow(container).run({
      input: [{
        name: "CDEK integration fixture",
        price_type: "calculated",
        provider_id: CDEK_PROVIDER_KEY,
        service_zone_id: sourceOption.service_zone_id,
        shipping_profile_id: sourceOption.shipping_profile_id,
        data: { delivery_type: "courier" },
        type: {
          label: "CDEK fixture",
          description: "Integration test option",
          code: "cdek-integration",
        },
      }],
    })
    cdekOption = created
  }
  const orderModule = container.resolve(Modules.ORDER) as any
  await orderModule.updateOrderShippingMethods({
    id: method.id,
    shipping_option_id: cdekOption.id,
    data: { cdekData: { tariff_code: 136 } },
  })
  const { result } = await createOrderFulfillmentWorkflow(container).run({
    input: {
      order_id: orderId,
      shipping_option_id: cdekOption.id,
      items: order.items.map((item: {
        id: string
        quantity: number
        detail?: { quantity?: number }
      }) => ({
        id: item.id,
        quantity: Number(item.detail?.quantity ?? item.quantity),
      })),
    },
  })
  const fulfillment = Array.isArray(result) ? result[0] : result
  if (!fulfillment?.id) throw new Error("Missing CDEK fulfillment fixture")
  const registry = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const [shipment] = await registry.listShippingShipments({
    order_id: orderId,
    provider_key: CDEK_PROVIDER_KEY,
  })
  if (!shipment) throw new Error("Missing CDEK shipment fixture")
  return registry.updateShippingShipments({
    id: shipment.id,
    simplified_status: status,
    status_event_at: new Date("2026-08-24T09:00:00.000Z"),
  })
}

function webhookEvent(uuid: string, orderUuid: string, code: string, at: string) {
  return {
    type: "ORDER_STATUS",
    uuid,
    date_time: at,
    attributes: {
      order_uuid: orderUuid,
      code,
      status_date_time: at,
      cdek_number: "integration-track",
    },
  }
}

async function postSignedWebhook(api: TestApiClient, body: Record<string, unknown>, secret: string) {
  const raw = JSON.stringify(body)
  return api.post("/catalog/webhooks/cdek", body, {
    headers: { "x-cdek-signature": cdekWebhookSignature(raw, secret) },
  })
}

jest.setTimeout(180 * 1000)

medusaIntegrationTestRunner({
  env: testEnv,
  testSuite: ({ api, getContainer }) => {
    let baseline: Awaited<ReturnType<typeof seedCommerceBaseline>>
    let variantId: string
    let adminToken: string
    let cdekProvider: CdekFulfillmentService
    const webhookSecret = Buffer.alloc(32, 29).toString("base64")

    beforeAll(async () => {
      const container = getContainer()
      baseline = await seedCommerceBaseline(container)
      variantId = await seedProduct(container, baseline)
      adminToken = await createAdminToken(
        container,
        `${uniqueValue("cdek-admin")}@test.com`,
        testEnv.JWT_SECRET
      )
      const registry = container.resolve<ShippingProviderRegistryModuleService>(
        SHIPPING_PROVIDER_REGISTRY_MODULE
      )
      cdekProvider = new CdekFulfillmentService({
        [SHIPPING_PROVIDER_REGISTRY_MODULE]: registry,
        [Modules.LOCKING]: container.resolve(Modules.LOCKING),
        [ContainerRegistrationKeys.LOGGER]: container.resolve(ContainerRegistrationKeys.LOGGER),
      })
      const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as any
      const storedProviders = await fulfillmentModule.listFulfillmentProviders({
        id: CDEK_PROVIDER_KEY,
      })
      if (!storedProviders.length) {
        await fulfillmentModule.fulfillmentProviderService_.create({
          id: CDEK_PROVIDER_KEY,
        })
      }
      await registry.saveProviderConfig({
        providerKey: CDEK_PROVIDER_KEY,
        credentials: { client_id: "integration-client", client_secret: webhookSecret },
        configuration: {
          contract_type: "online_store",
          sender: {
            city: "Москва",
            postal_code: "101000",
            street: "Складская, 1",
            contact_name: "Склад",
            phone: "+79990000000",
          },
        },
      })
      await registry.saveStorePackage({
        weight_grams: 1000,
        length_mm: 300,
        width_mm: 200,
        height_mm: 100,
      })
    })

    beforeEach(() => {
      const fulfillmentModule = getContainer().resolve(Modules.FULFILLMENT) as any
      const providerService = fulfillmentModule.fulfillmentProviderService_
      const retrieveProvider = providerService.retrieveProviderRegistration.bind(providerService)
      jest.spyOn(providerService, "retrieveProviderRegistration")
        .mockImplementation((providerId: string) =>
          providerId === CDEK_PROVIDER_KEY ? cdekProvider : retrieveProvider(providerId)
        )
      jest.spyOn(CdekClient.prototype, "createOrder")
        .mockImplementation(async (_credentials, input) => ({
          uuid: `direct-${input.number}`,
          cdek_number: `track-${input.number}`,
        }))
      jest.spyOn(CdekClient.prototype, "confirmOrderCreation")
        .mockImplementation(async (_credentials, uuid) => ({
          uuid,
          cdek_number: `track-${uuid}`,
        }))
    })

    afterEach(() => jest.restoreAllMocks())

    describe("CDEK webhook HTTP lifecycle", () => {
      it("rejects missing and invalid signatures without persisting the event", async () => {
        const container = getContainer()
        const registry = container.resolve<ShippingProviderRegistryModuleService>(
          SHIPPING_PROVIDER_REGISTRY_MODULE
        )
        const body = webhookEvent(uniqueValue("unsigned-event"), "missing-shipment", "DELIVERED", "2026-08-24T10:00:00.000Z")

        await expect(api.post("/catalog/webhooks/cdek", body))
          .rejects.toMatchObject({ response: { status: 401 } })
        await expect(api.post("/catalog/webhooks/cdek", body, {
          headers: { "x-cdek-signature": "0".repeat(64) },
        })).rejects.toMatchObject({ response: { status: 401 } })

        expect(await registry.listShippingWebhookEvents({ event_uuid: body.uuid })).toHaveLength(0)
      })

      it("applies a valid event once and stores one idempotency record", async () => {
        const container = getContainer()
        const registry = container.resolve<ShippingProviderRegistryModuleService>(
          SHIPPING_PROVIDER_REGISTRY_MODULE
        )
        const orderId = `webhook-order-${uniqueValue("once")}`
        const shipment = await registry.createShippingShipments({
          order_id: orderId,
          provider_key: CDEK_PROVIDER_KEY,
          status: "created",
          provider_shipment_id: `direct-${orderId}`,
          simplified_status: "placed",
        })
        const body = webhookEvent(uniqueValue("event-once"), shipment.provider_shipment_id!, "DELIVERED", "2026-08-24T12:00:00.000Z")

        expect((await postSignedWebhook(api, body, webhookSecret)).data.result.status).toBe("applied")
        expect((await postSignedWebhook(api, body, webhookSecret)).data.result.status).toBe("duplicate")

        const stored = await registry.retrieveShippingShipment(shipment.id)
        expect(stored.simplified_status).toBe("delivered")
        expect(stored.status_event_uuid).toBe(body.uuid)
        expect(await registry.listShippingWebhookEvents({ event_uuid: body.uuid })).toHaveLength(1)
      })

      it("does not roll a shipment back with an older event", async () => {
        const container = getContainer()
        const registry = container.resolve<ShippingProviderRegistryModuleService>(
          SHIPPING_PROVIDER_REGISTRY_MODULE
        )
        const orderId = `webhook-order-${uniqueValue("stale")}`
        const shipment = await registry.createShippingShipments({
          order_id: orderId,
          provider_key: CDEK_PROVIDER_KEY,
          status: "created",
          provider_shipment_id: `direct-${orderId}`,
          simplified_status: "placed",
        })
        const newer = webhookEvent(uniqueValue("event-new"), shipment.provider_shipment_id!, "DELIVERED", "2026-08-24T12:00:00.000Z")
        const older = webhookEvent(uniqueValue("event-old"), shipment.provider_shipment_id!, "RECEIVED_AT_SHIPMENT_WAREHOUSE", "2026-08-24T11:00:00.000Z")

        await postSignedWebhook(api, newer, webhookSecret)
        expect((await postSignedWebhook(api, older, webhookSecret)).data.result.status).toBe("ignored")

        const stored = await registry.retrieveShippingShipment(shipment.id)
        expect(stored.simplified_status).toBe("delivered")
        expect(stored.status_event_uuid).toBe(newer.uuid)
      })
    })

    describe("CDEK cancellation and return HTTP lifecycle", () => {
      async function seededAccountOrder(status: "placed" | "preparing" | "in_transit" | "delivered") {
        const email = `${uniqueValue("cdek-buyer")}@test.com`
        const orderId = await placeOrder(api, baseline, variantId, email)
        const session = await createCustomerSession(api, baseline, email)
        const shipment = await attachCdekShipment(getContainer(), orderId, status)
        return { orderId, session, shipment }
      }

      it("cancels the order while the CDEK shipment is still placed", async () => {
        const { orderId, session } = await seededAccountOrder("placed")
        const deleteOrder = jest.spyOn(CdekClient.prototype, "deleteOrder").mockResolvedValue()

        const response = await api.post(
          `/store/account/orders/${orderId}/cancel`,
          {},
          { headers: storeHeaders(baseline, authHeaders(session.token)) }
        )

        expect(response.data).toEqual(expect.objectContaining({
          outcome: "canceled",
          message: "Заказ отменён",
          order: expect.objectContaining({ id: orderId, status: "canceled" }),
        }))
        expect(deleteOrder).toHaveBeenCalledTimes(1)
      })

      it("returns exactly one return-request outcome when shipment status has advanced", async () => {
        const { orderId, session, shipment } = await seededAccountOrder("placed")
        const warehouseEvent = webhookEvent(
          uniqueValue("warehouse-race-event"),
          shipment.provider_shipment_id!,
          "RECEIVED_AT_SHIPMENT_WAREHOUSE",
          "2026-08-24T10:00:00.000Z"
        )
        const webhook = await postSignedWebhook(api, warehouseEvent, webhookSecret)
        expect(webhook.data.result.status).toBe("applied")

        const response = await api.post(
          `/store/account/orders/${orderId}/cancel`,
          {},
          { headers: storeHeaders(baseline, authHeaders(session.token)) }
        )
        const registry = getContainer().resolve<ShippingProviderRegistryModuleService>(
          SHIPPING_PROVIDER_REGISTRY_MODULE
        )
        const requests = await registry.listShippingReturnRequests({ order_id: orderId })

        expect(response.data).toEqual(expect.objectContaining({
          outcome: "return_requested",
          message: "Заявка на возврат отправлена",
          order: expect.objectContaining({ id: orderId }),
        }))
        expect(response.data.order.status).not.toBe("canceled")
        expect(requests).toHaveLength(1)
        expect(requests[0].status).toBe("pending")
      })

      it("restores the previous delivery status when an admin rejects the request", async () => {
        const { orderId, session, shipment } = await seededAccountOrder("delivered")
        const requested = await api.post(
          `/store/account/orders/${orderId}/return`,
          {},
          { headers: storeHeaders(baseline, authHeaders(session.token)) }
        )
        const registry = getContainer().resolve<ShippingProviderRegistryModuleService>(
          SHIPPING_PROVIDER_REGISTRY_MODULE
        )
        expect((await registry.retrieveShippingShipment(shipment.id)).simplified_status)
          .toBe("return_in_progress")

        const rejected = await api.post(
          `/admin/shipping-return-requests/${requested.data.return_request.id}`,
          { decision: "reject" },
          { headers: authHeaders(adminToken) }
        )

        expect(rejected.data.return_request.status).toBe("rejected")
        expect((await registry.retrieveShippingShipment(shipment.id)).simplified_status)
          .toBe("delivered")
      })

      it("creates a reverse shipment and persists its tracking number on approval", async () => {
        const { orderId, session } = await seededAccountOrder("delivered")
        const requested = await api.post(
          `/store/account/orders/${orderId}/return`,
          {},
          { headers: storeHeaders(baseline, authHeaders(session.token)) }
        )
        const findOrder = jest.spyOn(CdekClient.prototype, "findOrderByNumber")
          .mockResolvedValue(null)
        const createOrder = jest.spyOn(CdekClient.prototype, "createOrder")
          .mockResolvedValue({ uuid: uniqueValue("return-uuid"), cdek_number: "return-track-100" })

        const approved = await api.post(
          `/admin/shipping-return-requests/${requested.data.return_request.id}`,
          { decision: "approve" },
          { headers: authHeaders(adminToken) }
        )

        expect(approved.data.return_request).toEqual(expect.objectContaining({
          status: "approved",
          return_provider_shipment_id: expect.any(String),
          return_tracking_number: "return-track-100",
          return_delivery_status: "placed",
        }))
        // Count only reverse lookups: the forward shipment reconciles itself in
        // the background and looks up its own order number, which has nothing to
        // do with the idempotent recovery this test is about.
        const reverseLookups = findOrder.mock.calls.filter(
          ([, number]) => typeof number === "string" && number.startsWith("return-")
        )
        expect(reverseLookups).toHaveLength(1)
        const reverseCreations = createOrder.mock.calls.filter(
          ([, payload]) => (payload as { is_return?: boolean })?.is_return === true
        )
        expect(reverseCreations).toHaveLength(1)
        expect(reverseCreations[0][0]).toEqual(
          expect.objectContaining({ client_id: expect.any(String), client_secret: expect.any(String) })
        )
        const registry = getContainer().resolve<ShippingProviderRegistryModuleService>(
          SHIPPING_PROVIDER_REGISTRY_MODULE
        )
        expect(await registry.retrieveShippingReturnRequest(
          requested.data.return_request.id
        )).toEqual(expect.objectContaining({
          status: "approved",
          return_tracking_number: "return-track-100",
        }))
      })
    })
  },
})
