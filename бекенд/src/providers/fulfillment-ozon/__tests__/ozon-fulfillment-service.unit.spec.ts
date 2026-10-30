import { MedusaError } from "@medusajs/framework/utils"

import { encryptShippingProviderCredentials } from "../../../modules/shipping-provider-registry/credentials"
import OzonFulfillmentService from "../service"

const credentials = { client_id: "client", client_secret: "secret" }

function cacheMock() {
  const values = new Map<string, unknown>()
  return {
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      values.set(key, value)
    }),
    invalidate: jest.fn(async (key: string) => {
      values.delete(key)
    }),
  }
}

const storePackage = { weight_grams: 500, length_mm: 300, width_mm: 200, height_mm: 150 }

function service(
  client: Record<string, jest.Mock>,
  options: Record<string, unknown> = {},
  dependencies: Record<string, unknown> = {}
) {
  const cache = cacheMock()
  const registry = {
    getStorePackage: jest.fn().mockResolvedValue(
      "storePackage" in options ? options.storePackage : storePackage
    ),
  }
  return {
    cache,
    provider: new OzonFulfillmentService(
      { cacheService: cache as any, shippingProviderRegistry: registry as any, ...dependencies },
      {
        client: client as any,
        credentials,
        configuration: {
          sender: { city: "Москва", postal_code: "101000" },
          max_weight_grams: 10_000,
          ...(options.configuration as object | undefined),
        },
        ...options,
      }
    ),
  }
}

describe("OzonFulfillmentService", () => {
  it("does not require a test endpoint during Medusa boot", () => {
    const previous = process.env.OZON_API_BASE_URL
    delete process.env.OZON_API_BASE_URL
    expect(() => new OzonFulfillmentService({ cacheService: cacheMock() as any })).not.toThrow()
    if (previous === undefined) delete process.env.OZON_API_BASE_URL
    else process.env.OZON_API_BASE_URL = previous
  })

  it("delegates carrier operations through its client", async () => {
    const client = {
      testAuthorization: jest.fn(),
      listPickupPoints: jest.fn().mockResolvedValue([]),
      verifyWebhook: jest.fn().mockReturnValue(true),
      createReturn: jest.fn().mockResolvedValue({ id: "return-1" }),
    }
    const { provider } = service(client)

    await provider.testCredentials(credentials)
    await provider.listPickupPoints(credentials)
    await expect(provider.createReturnShipment({
      return_id: "ret_1",
      forward_shipment_id: "shipment-1",
      reason: "customer_return",
    })).resolves.toEqual({
      id: "return-1",
      tracking_number: null,
      register_shipment: false,
    })
    expect(provider.verifyWebhook(Buffer.from("raw"), { "x-ozon-signature": "signature" }, "secret"))
      .toBe(true)

    expect(client.testAuthorization).toHaveBeenCalledWith(credentials)
    expect(client.listPickupPoints).toHaveBeenCalledWith(credentials)
    expect(client.createReturn).toHaveBeenCalledWith(
      credentials,
      {
        shipment_id: "shipment-1",
        external_number: "return-ret_1",
        reason: "customer_return",
      },
      "return:ret_1"
    )
    expect(client.verifyWebhook).toHaveBeenCalledWith(
      Buffer.from("raw"),
      { "x-ozon-signature": "signature" },
      "secret"
    )
  })

  it("decrypts stored credentials before calling its client", async () => {
    const previousKey = process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "ozon-test-encryption-key"

    try {
      const client = { calculateTariffs: jest.fn().mockResolvedValue([]) }
      const registry = {
        getProviderConfig: jest.fn().mockResolvedValue({
          encrypted_credentials: encryptShippingProviderCredentials(credentials),
          configuration: { sender: { city: "Москва", postal_code: "101000" } },
        }),
        getStorePackage: jest.fn().mockResolvedValue(storePackage),
      }
      const { provider } = service(client, { credentials: undefined }, {
        shippingProviderRegistry: registry,
      })

      await provider.calculateAvailableTariffs({ city: "Тула", weight_grams: 1_000 })

      expect(client.calculateTariffs).toHaveBeenCalledWith(
        credentials,
        expect.any(Object)
      )
    } finally {
      if (previousKey === undefined) delete process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY
      else process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = previousKey
    }
  })

  it("normalizes tariffs and returns the selected Medusa price", async () => {
    const client = {
      calculateTariffs: jest.fn().mockResolvedValue([
        {
          tariff_id: 42,
          tariff_name: "Ozon ПВЗ",
          price: { amount: 349.5, currency: "RUB" },
          period_min: 2,
          period_max: 4,
          delivery_type: "pickup",
        },
        {
          code: "courier-1",
          name: "Ozon Courier",
          price: 599,
          currency: "RUB",
          delivery_days_min: 1,
          delivery_days_max: 2,
          delivery_type: "courier",
        },
      ]),
    }
    const { provider } = service(client)
    const input = {
      city: "Тула",
      postal_code: "300000",
      weight_grams: 1_200,
      package: { length_mm: 300, width_mm: 200, height_mm: 150 },
    } as any

    await expect(provider.calculateAvailableTariffs(input)).resolves.toEqual([
      {
        code: "42",
        name: "Ozon ПВЗ",
        price: 349.5,
        type: "pickup",
        currency: "RUB",
        delivery_days_min: 2,
        delivery_days_max: 4,
      },
      expect.objectContaining({ code: "courier-1", type: "courier", price: 599 }),
    ])
    await expect(provider.calculatePrice(
      { delivery_type: "pickup" },
      input
    )).resolves.toMatchObject({
      amount: 349.5,
      currency_code: "RUB",
      calculated_amount: 349.5,
      is_calculated_price_tax_inclusive: true,
      data: { selected_tariff: { code: "42" } },
    })
    expect(client.calculateTariffs).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        from: { city: "Москва", postal_code: "101000" },
        to: { city: "Тула", postal_code: "300000" },
        packages: [expect.objectContaining({ weight_grams: 1_200 })],
      })
    )
  })

  it("prices every Ozon tariff on the stored store package, not on context dimensions", async () => {
    const client = { calculateTariffs: jest.fn().mockResolvedValue([]) }
    const { provider } = service(client)

    await provider.calculateAvailableTariffs({
      city: "Тула",
      postal_code: "300000",
      weight_grams: 1_200,
      package: { length_mm: 1, width_mm: 1, height_mm: 1 },
    } as any)

    expect(client.calculateTariffs).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        packages: [{ weight_grams: 1_200, length_mm: 300, width_mm: 200, height_mm: 150 }],
      })
    )
  })

  it("offers no tariffs and never calls Ozon when the store package is missing", async () => {
    const client = { calculateTariffs: jest.fn().mockResolvedValue([]) }
    const { provider } = service(client, { storePackage: null })

    await expect(provider.calculateAvailableTariffs({
      city: "Тула",
      postal_code: "300000",
      items: [{ quantity: 1, variant: { weight: 1_200 } }],
    } as any)).resolves.toEqual([])
    expect(client.calculateTariffs).not.toHaveBeenCalled()
  })

  it("rejects a pickup point when the store package is missing", async () => {
    const client = { listPickupPoints: jest.fn().mockResolvedValue([]) }
    const { provider } = service(client, { storePackage: null })

    await expect(provider.validateOption({
      delivery_type: "pickup",
      pickup_point_id: "point-1",
      city: "Тула",
    } as any, {
      city: "Тула",
      items: [{ quantity: 1, variant: { weight: 1_200 } }],
    } as any)).resolves.toBe(false)
    expect(client.listPickupPoints).not.toHaveBeenCalled()
  })

  it("validates a pickup point by city and weight and caches its list for one hour", async () => {
    const client = {
      listPickupPoints: jest.fn().mockResolvedValue([
        {
          id: "point-1",
          name: "ПВЗ Тула",
          address: "Тула, Советская, 1",
          city: "Тула",
          latitude: 54.19,
          longitude: 37.62,
          working_hours: "09:00-21:00",
          max_weight_grams: 2_000,
        },
      ]),
    }
    const { provider, cache } = service(client)
    const option = { delivery_type: "pickup", pickup_point_id: "point-1" }
    const context = { cart_id: "cart-1", city: "Тула", weight_grams: 1_500 }

    await expect(provider.validateOption(option, context)).resolves.toBe(true)
    await expect(provider.validateOption(option, context)).resolves.toBe(true)

    expect(client.listPickupPoints).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith(
      "ozon:pickup-points:тула",
      expect.arrayContaining([expect.objectContaining({ id: "point-1" })]),
      3_600
    )
    await expect(provider.validateOption(option, {
      ...context,
      weight_grams: 2_001,
    })).resolves.toBe(false)
    await expect(provider.validateOption(option, {
      ...context,
      city: "Москва",
    })).resolves.toBe(false)
  })

  it("invalidates the pickup list when another point is selected", async () => {
    const client = {
      listPickupPoints: jest.fn().mockResolvedValue([
        { id: "point-1", name: "ПВЗ 1", address: "Тула, 1", city: "Тула" },
        { id: "point-2", name: "ПВЗ 2", address: "Тула, 2", city: "Тула" },
      ]),
    }
    const { provider, cache } = service(client, { pickupPointCacheTtlSeconds: 120 })
    const context = { cart_id: "cart-1", city: "Тула", weight_grams: 500 }

    await provider.validateOption(
      { delivery_type: "pickup", pickup_point_id: "point-1" },
      context
    )
    await provider.validateOption(
      { delivery_type: "pickup", pickup_point_id: "point-2" },
      context
    )

    expect(cache.invalidate).toHaveBeenCalledWith("ozon:pickup-points:тула")
    expect(cache.set).toHaveBeenCalledWith(
      "ozon:selected-pickup-point:cart-1",
      { point_id: "point-2", city: "Тула" },
      120
    )
  })

  it("creates and cancels a normalized shipment with an idempotency key", async () => {
    const client = {
      createShipment: jest.fn().mockResolvedValue({
        shipment_id: "shipment-1",
        tracking_number: "OZON-TRACK-1",
        status: "created",
      }),
      cancelShipment: jest.fn().mockResolvedValue(true),
    }
    const { provider } = service(client)

    await expect(provider.createFulfillment(
      {
        external_number: "order-1",
        delivery_type: "courier",
        city: "Тула",
        weight_grams: 500,
      },
      "order-1:create"
    )).resolves.toEqual({
      id: "shipment-1",
      tracking_number: "OZON-TRACK-1",
      status: "created",
      data: expect.objectContaining({
        ozon_shipment_id: "shipment-1",
        tracking_number: "OZON-TRACK-1",
      }),
    })
    expect(client.createShipment).toHaveBeenCalledWith(
      credentials,
      expect.objectContaining({ external_number: "order-1" }),
      "order-1:create"
    )

    await expect(provider.cancelFulfillment(
      { ozon_shipment_id: "shipment-1" },
      "customer request"
    )).resolves.toBe(true)
    expect(client.cancelShipment).toHaveBeenCalledWith(credentials, "shipment-1")
  })

  it("claims, completes, and reuses a forward shipment through IFulfillmentProvider", async () => {
    const client = {
      createShipment: jest.fn().mockResolvedValue({
        id: "shipment-2",
        tracking_number: "TRACK-2",
        status: "created",
      }),
    }
    let storedShipment: any = null
    const registry = {
      listShippingShipments: jest.fn(async () => storedShipment ? [storedShipment] : []),
      claimShippingShipment: jest.fn(async (input) => {
        storedShipment = { id: "shipment-record-1", ...input, status: "creating" }
        return { shipment: storedShipment, created: true }
      }),
      updateShippingShipments: jest.fn(async (input) => {
        storedShipment = { ...storedShipment, ...input }
        return storedShipment
      }),
    }
    const { provider } = service(client, {}, {
      shippingProviderRegistry: registry,
      locking: { execute: jest.fn(async (_key, job) => job()) },
    })
    const args = [
      { weight_grams: 500 },
      [{ title: "Краска", quantity: 1 }],
      { id: "order-2", shipping_address: { id: "address-2", city: "Тула" } },
      { id: "fulfillment-2" },
    ] as const

    await expect(provider.createFulfillment(
      args[0], args[1] as any, args[2] as any, args[3] as any
    )).resolves.toEqual({
      data: expect.objectContaining({
        ozon_shipment_id: "shipment-2",
        tracking_number: "TRACK-2",
      }),
      labels: [],
    })
    await provider.createFulfillment(args[0], args[1] as any, args[2] as any, args[3] as any)

    expect(registry.claimShippingShipment).toHaveBeenCalledWith({
      order_id: "order-2",
      provider_key: "ozon_ozon",
      business_action_id: "fulfillment-2",
      direction: "forward",
      destination_key: "address-2",
    })
    expect(client.createShipment).toHaveBeenCalledWith(
      credentials,
      expect.objectContaining({ external_number: "order-2" }),
      "fulfillment-2"
    )
    expect(client.createShipment).toHaveBeenCalledTimes(1)
    expect(storedShipment).toMatchObject({
      status: "created",
      provider_shipment_id: "shipment-2",
      tracking_number: "TRACK-2",
      reconciliation_required: false,
    })
  })

  it("wraps OzonClient failures in MedusaError without making a real request", async () => {
    const client = {
      calculateTariffs: jest.fn().mockRejectedValue(new Error("Ozon unavailable")),
    }
    const { provider } = service(client)

    const promise = provider.calculateAvailableTariffs({
      city: "Тула",
      weight_grams: 500,
    } as any)

    await expect(promise).rejects.toBeInstanceOf(MedusaError)
    await expect(promise).rejects.toThrow("Ozon unavailable")
  })
})
