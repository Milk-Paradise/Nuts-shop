import { encryptShippingProviderCredentials } from "../../../modules/shipping-provider-registry/credentials"
import CdekFulfillmentService, { CdekFulfillmentError } from "../service"
import { CdekApiError } from "../../../modules/shipping-provider-registry/cdek-client"

const cdekCityCandidate = {
  code: 123,
  city: "Тула",
  country_code: "RU",
  region: "Тульская область",
  region_code: 71,
}

function cdekLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}

function cityResolutionRegistry(initial: any[] = []) {
  const records = [...initial]
  const keyFields = ["country_code", "city", "region", "postal_code"] as const
  const registry = {
    listShippingCdekCityResolutionCaches: jest.fn(async (filters) =>
      records.filter((record) => keyFields.every((field) => record[field] === filters[field]))
    ),
    createShippingCdekCityResolutionCaches: jest.fn(async (input) => {
      records.push({ id: `cache_${records.length + 1}`, ...input })
      return records.at(-1)
    }),
  }
  return { registry, records }
}

describe("CdekFulfillmentService", () => {
  const originalKey = process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "unit-test-key"
  })

  afterAll(() => {
    if (originalKey === undefined) delete process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY
    else process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = originalKey
  })

  it("delegates carrier operations through its client", async () => {
    const client = {
      testAuthorization: jest.fn(),
      listDeliveryPoints: jest.fn().mockResolvedValue([]),
      listAvailableTariffs: jest.fn().mockResolvedValue([]),
      requestBarcodeLabel: jest.fn().mockResolvedValue({ uuid: "label-1", url: null }),
      downloadBarcodeLabel: jest.fn().mockResolvedValue(Buffer.from("pdf")),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: {}, locking: {} } as any,
      { client: client as any }
    )
    const credentials = { client_id: "id", client_secret: "secret" }
    const tariffs = {
      contract_type: "online_store" as const,
      sender: { city: "Москва", postal_code: "101000" },
      package: { weight_grams: 1000, length_mm: 300, width_mm: 200, height_mm: 150 },
    }

    await service.testCredentials(credentials)
    await service.listPickupPoints(credentials)
    await service.listAvailableTariffs(credentials, tariffs)
    await service.requestFulfillmentLabel(credentials, "shipment-1")
    await service.downloadFulfillmentLabel(credentials, "label-1")

    expect(client.testAuthorization).toHaveBeenCalledWith(credentials)
    expect(client.listDeliveryPoints).toHaveBeenCalledWith(credentials)
    expect(client.listAvailableTariffs).toHaveBeenCalledWith(credentials, tariffs)
    expect(client.requestBarcodeLabel).toHaveBeenCalledWith(credentials, "shipment-1")
    expect(client.downloadBarcodeLabel).toHaveBeenCalledWith(credentials, "label-1")
  })

  it("creates a return shipment once and reuses the carrier order on retry", async () => {
    const registry = {
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
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
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 1_000,
        length_mm: 300,
        width_mm: 200,
        height_mm: 100,
      }),
    }
    const client = {
      findOrderByNumber: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ uuid: "return-uuid", cdek_number: "return-track" }),
      createOrder: jest.fn().mockResolvedValue({ uuid: "return-uuid", cdek_number: "return-track" }),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: {} } as any,
      { client: client as any }
    )
    const input = {
      return_id: "ret_1",
      forward_shipment_id: "forward-uuid",
      order: {
        id: "order_1",
        display_id: 42,
        shipping_address: {
          city: "Тула",
          postal_code: "300000",
          address_1: "Ленина, 1",
          phone: "+79991111111",
        },
        items: [{ id: "item_1", title: "Краска", variant_sku: "SKU-1", quantity: 1 }],
        shipping_methods: [{ data: { cdekData: { tariff_code: 136 } } }],
      },
    }

    await expect(service.createReturnShipment(input)).resolves.toEqual({
      id: "return-uuid",
      tracking_number: "return-track",
      register_shipment: true,
    })
    await service.createReturnShipment(input)

    expect(client.findOrderByNumber).toHaveBeenCalledWith(
      { client_id: "id", client_secret: "secret" },
      "return-ret_1"
    )
    expect(client.createOrder).toHaveBeenCalledTimes(1)
    expect(client.createOrder).toHaveBeenCalledWith(
      { client_id: "id", client_secret: "secret" },
      expect.objectContaining({
        number: "return-ret_1",
        is_return: true,
        from_location: expect.objectContaining({ city: "Тула" }),
        to_location: expect.objectContaining({ city: "Москва" }),
      })
    )
  })

  it.each(["credentials", "store package"] as const)(
    "requires %s before creating a return shipment",
    async (missing) => {
      const registry = {
        getProviderConfig: jest.fn().mockResolvedValue(
          missing === "credentials"
            ? { configuration: {} }
            : {
                encrypted_credentials: encryptShippingProviderCredentials({
                  client_id: "id",
                  client_secret: "secret",
                }),
                configuration: {},
              }
        ),
        getStorePackage: jest.fn().mockResolvedValue(
          missing === "store package"
            ? null
            : { weight_grams: 1_000, length_mm: 300, width_mm: 200, height_mm: 100 }
        ),
      }
      const client = { findOrderByNumber: jest.fn(), createOrder: jest.fn() }
      const service = new CdekFulfillmentService(
        { shippingProviderRegistry: registry, locking: {} } as any,
        { client: client as any }
      )

      await expect(service.createReturnShipment({
        return_id: "ret_1",
        forward_shipment_id: "forward-uuid",
        order: { id: "order_1" },
      })).rejects.toThrow("Конфигурация СДЭК неполна")
      expect(client.findOrderByNumber).not.toHaveBeenCalled()
      expect(client.createOrder).not.toHaveBeenCalled()
    }
  )

  it("aggregates item weights into one store-sized package", async () => {
    const cityCache = cityResolutionRegistry()
    const registry = {
      ...cityCache.registry,
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: true }]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: {
          sender: { city: "Москва", postal_code: "101000" },
          contract_type: "online_store",
          tariff_codes: [136, 137],
        },
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 400,
        length_mm: 300,
        width_mm: 200,
        height_mm: 150,
      }),
    }
    const client = {
      findCities: jest.fn().mockResolvedValue([cdekCityCandidate]),
      calculateTariffs: jest.fn().mockResolvedValue([]),
    }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, logger } as any,
      { client: client as any }
    )

    await service.calculateAvailableTariffs({
      shipping_address: { country_code: "ru", city: "Тула", postal_code: "300000" },
      items: [
        { quantity: 2, variant: { weight: 250 } },
        { quantity: 3, variant: { weight: null } },
      ],
    } as any)

    expect(client.calculateTariffs).toHaveBeenCalledWith(
      { client_id: "id", client_secret: "secret" },
      expect.objectContaining({
        package: { weight_grams: 1700, length_mm: 300, width_mm: 200, height_mm: 150 },
      })
    )
    expect(client.findCities).toHaveBeenCalledWith(
      { client_id: "id", client_secret: "secret" },
      { country_code: "RU", city: "тула" }
    )
    expect(cityCache.registry.createShippingCdekCityResolutionCaches).toHaveBeenCalledWith(
      expect.objectContaining({ city_code: 123, candidate: cdekCityCandidate })
    )
  })

  it("offers no tariffs and never calls CDEK when the store package is missing", async () => {
    const registry = {
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: true }]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: {
          sender: { city: "Москва", postal_code: "101000" },
          contract_type: "online_store",
          tariff_codes: [136],
        },
      }),
      getStorePackage: jest.fn().mockResolvedValue(null),
    }
    const client = { calculateTariffs: jest.fn().mockResolvedValue([]) }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry } as any,
      { client: client as any }
    )

    await expect(
      service.calculateAvailableTariffs({
        shipping_address: { city: "Тула", postal_code: "300000" },
        items: [{ quantity: 1, variant: { weight: 250 } }],
      } as any)
    ).resolves.toEqual([])
    expect(client.calculateTariffs).not.toHaveBeenCalled()
  })

  it("returns a cached city code without calling the CDEK directory", async () => {
    const cityCache = cityResolutionRegistry([{
      country_code: "RU",
      city: "тула",
      region: "",
      postal_code: "300000",
      city_code: 123,
      candidate: cdekCityCandidate,
    }])
    const client = { findCities: jest.fn().mockRejectedValue(new Error("must not be called")) }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: cityCache.registry, locking: {}, logger } as any,
      { client: client as any }
    )

    await expect(service.resolveCityCode(
      { client_id: "id", client_secret: "secret" },
      { country_code: "ru", city: " Тула ", postal_code: "300000" }
    )).resolves.toEqual({ status: "resolved", code: 123, candidate: cdekCityCandidate })

    expect(client.findCities).not.toHaveBeenCalled()
    expect(cityCache.registry.createShippingCdekCityResolutionCaches).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(
      "event=cdek_city_resolve_cache_hit country_code=RU city=тула region=- postal_code=300000 city_code=123"
    ))
  })

  it("reads the cache again after acquiring the distributed city lock", async () => {
    const cached = {
      country_code: "RU",
      city: "тула",
      region: "",
      postal_code: "",
      city_code: 123,
      candidate: cdekCityCandidate,
    }
    let reads = 0
    const registry = {
      listShippingCdekCityResolutionCaches: jest.fn(async () => ++reads === 1 ? [] : [cached]),
      createShippingCdekCityResolutionCaches: jest.fn(),
    }
    const locking = { execute: jest.fn(async (_key, work) => work()) }
    const client = { findCities: jest.fn() }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking } as any,
      { client: client as any }
    )

    await expect(service.resolveCityCode(
      { client_id: "id", client_secret: "secret" },
      { country_code: "RU", city: "Тула" }
    )).resolves.toEqual({ status: "resolved", code: 123, candidate: cdekCityCandidate })

    expect(locking.execute).toHaveBeenCalledWith(
      "cdek-city-resolve:RU:тула::",
      expect.any(Function),
      { timeout: 10 }
    )
    expect(client.findCities).not.toHaveBeenCalled()
  })

  it("persists the only CDEK city candidate before returning it", async () => {
    const cityCache = cityResolutionRegistry()
    const client = { findCities: jest.fn().mockResolvedValue([cdekCityCandidate]) }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: cityCache.registry, locking: {}, logger } as any,
      { client: client as any }
    )

    await expect(service.resolveCityCode(
      { client_id: "id", client_secret: "secret" },
      { country_code: "RU", city: "Тула", region: "Тульская область" }
    )).resolves.toEqual({ status: "resolved", code: 123, candidate: cdekCityCandidate })

    expect(cityCache.records).toEqual([expect.objectContaining({
      country_code: "RU",
      city: "тула",
      region: "тульская область",
      postal_code: "",
      city_code: 123,
      candidate: cdekCityCandidate,
      fetched_at: expect.any(Date),
      expires_at: expect.any(Date),
    })])
    expect(cityCache.records[0].expires_at.getTime()).toBeGreaterThan(
      cityCache.records[0].fetched_at.getTime()
    )
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(
      "event=cdek_city_resolve_cache_miss country_code=RU city=тула region=\"тульская область\" postal_code=- status=resolved city_code=123"
    ))
  })

  it("uses the first CDEK city candidate without ranking", async () => {
    const first = { ...cdekCityCandidate, code: 456, region: "Тульская область" }
    const cityCache = cityResolutionRegistry()
    const client = { findCities: jest.fn().mockResolvedValue([first, cdekCityCandidate]) }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: cityCache.registry, locking: {}, logger } as any,
      { client: client as any }
    )

    await expect(service.resolveCityCode(
      { client_id: "id", client_secret: "secret" },
      { country_code: "RU", city: "Тула" }
    )).resolves.toEqual({ status: "resolved", code: 456, candidate: first })

    expect(cityCache.records[0]).toEqual(expect.objectContaining({
      city_code: 456,
      candidate: first,
    }))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(
      "event=cdek_city_resolve_ambiguous country_code=RU city=тула region=- postal_code=- total_candidates=2 city_code=456"
    ))
  })

  it("does not calculate tariffs when the CDEK directory finds no city", async () => {
    const cityCache = cityResolutionRegistry()
    const registry = {
      ...cityCache.registry,
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: true }]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: {
          sender: { city: "Москва", postal_code: "101000" },
          contract_type: "online_store",
          tariff_codes: [136],
        },
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 400, length_mm: 300, width_mm: 200, height_mm: 150,
      }),
    }
    const client = {
      findCities: jest.fn().mockResolvedValue([]),
      calculateTariffs: jest.fn().mockResolvedValue([]),
    }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: {}, logger } as any,
      { client: client as any }
    )

    await expect(service.calculateAvailableTariffs({
      shipping_address: { country_code: "ru", city: "Тула", postal_code: "300000" },
      items: [{ quantity: 1, variant: { weight: 250 } }],
    } as any)).resolves.toEqual([])

    expect(client.findCities).toHaveBeenCalledTimes(1)
    expect(client.calculateTariffs).not.toHaveBeenCalled()
    expect(cityCache.registry.createShippingCdekCityResolutionCaches).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(
      "event=cdek_city_resolve_not_found country_code=RU city=тула region=- postal_code=300000"
    ))
  })

  it("wraps an uncached CDEK directory failure as a fulfillment error", async () => {
    const cityCache = cityResolutionRegistry()
    const client = { findCities: jest.fn().mockRejectedValue(new Error("directory timeout")) }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: cityCache.registry, locking: {}, logger } as any,
      { client: client as any }
    )

    await expect(service.resolveCityCode(
      { client_id: "id", client_secret: "secret" },
      { country_code: "RU", city: "Тула" }
    )).rejects.toBeInstanceOf(CdekFulfillmentError)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(
      "event=cdek_city_resolve_directory_error country_code=RU city=тула region=- postal_code=- error_message=\"directory timeout\""
    ))
  })

  it("joins concurrent cache misses without a locking module", async () => {
    const cityCache = cityResolutionRegistry()
    const client = {
      findCities: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return [cdekCityCandidate]
      }),
    }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: cityCache.registry, locking: {}, logger } as any,
      { client: client as any }
    )
    const credentials = { client_id: "id", client_secret: "secret" }
    const address = { country_code: "RU", city: "Тула", postal_code: "300000" }

    await expect(Promise.all([
      service.resolveCityCode(credentials, address),
      service.resolveCityCode(credentials, address),
    ])).resolves.toEqual([
      { status: "resolved", code: 123, candidate: cdekCityCandidate },
      { status: "resolved", code: 123, candidate: cdekCityCandidate },
    ])

    expect(client.findCities).toHaveBeenCalledTimes(1)
    expect(cityCache.registry.createShippingCdekCityResolutionCaches).toHaveBeenCalledTimes(1)
    expect(cityCache.records).toHaveLength(1)
  })

  it("uses the winner from the cache when a concurrent insert conflicts", async () => {
    const winner = { ...cdekCityCandidate, code: 789 }
    const records = [{
      country_code: "RU",
      city: "тула",
      region: "",
      postal_code: "",
      city_code: 789,
      candidate: winner,
    }]
    let reads = 0
    const registry = {
      listShippingCdekCityResolutionCaches: jest.fn(async () => {
        reads += 1
        return reads >= 3 ? records : []
      }),
      createShippingCdekCityResolutionCaches: jest.fn().mockRejectedValue(new Error("duplicate key")),
    }
    const client = { findCities: jest.fn().mockResolvedValue([cdekCityCandidate]) }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: {}, logger } as any,
      { client: client as any }
    )

    await expect(service.resolveCityCode(
      { client_id: "id", client_secret: "secret" },
      { country_code: "RU", city: "Тула" }
    )).resolves.toEqual({ status: "resolved", code: 789, candidate: winner })

    expect(registry.createShippingCdekCityResolutionCaches).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["courier", 1, "Курьер"],
    ["pickup", 2, "ПВЗ"],
  ])("passes the resolved city code to %s tariff calculation", async (deliveryType, deliveryMode, tariffName) => {
    const cityCache = cityResolutionRegistry()
    const registry = {
      ...cityCache.registry,
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: true }]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: {
          sender: { city: "Москва", postal_code: "101000" },
          contract_type: "online_store",
          tariff_codes: [136],
        },
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 400, length_mm: 300, width_mm: 200, height_mm: 150,
      }),
    }
    const client = {
      findCities: jest.fn().mockResolvedValue([cdekCityCandidate]),
      calculateTariffs: jest.fn().mockResolvedValue([{
        code: 136, name: tariffName, description: null, delivery_mode: deliveryMode,
        delivery_sum: 300, period_min: 1, period_max: 2,
      }]),
    }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: {}, logger } as any,
      { client: client as any }
    )

    await expect(service.calculatePrice(
      { delivery_type: deliveryType },
      {},
      {
        shipping_address: {
          country_code: "ru", city: "Тула", province: "ru-tul", postal_code: "300000",
        },
        items: [{ quantity: 1, variant: { weight: 250 } }],
      } as any
    )).resolves.toEqual(expect.objectContaining({ calculated_amount: 300 }))

    expect(client.findCities).toHaveBeenCalledWith(
      { client_id: "id", client_secret: "secret" },
      { country_code: "RU", city: "тула" }
    )
    const calculationInput = client.calculateTariffs.mock.calls[0][1]
    expect(calculationInput.recipient).toEqual({ code: 123, postal_code: "300000" })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(
      `event=cdek_tariff_calculated delivery_mode=${deliveryMode}`
    ))
  })

  it("calculates price when the shipping option carries no provider data (Medusa passes data=undefined)", async () => {
    const cityCache = cityResolutionRegistry()
    const registry = {
      ...cityCache.registry,
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: true }]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: {
          sender: { city: "Москва", postal_code: "101000" },
          contract_type: "online_store",
          tariff_codes: [136],
        },
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 400, length_mm: 300, width_mm: 200, height_mm: 150,
      }),
    }
    const client = {
      findCities: jest.fn().mockResolvedValue([cdekCityCandidate]),
      calculateTariffs: jest.fn().mockResolvedValue([{
        code: 136, name: "Курьер", description: null, delivery_mode: 1,
        delivery_sum: 300, period_min: 1, period_max: 2,
      }]),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: {}, logger: cdekLogger() } as any,
      { client: client as any }
    )

    await expect(service.calculatePrice(
      { delivery_type: "courier" },
      undefined as any,
      {
        shipping_address: {
          country_code: "ru", city: "Тула", province: "ru-tul", postal_code: "300000",
        },
        items: [{ quantity: 1, variant: { weight: 250 } }],
      } as any
    )).resolves.toEqual(expect.objectContaining({ calculated_amount: 300 }))
  })

  it.each([
    ["a timeout", new CdekApiError("calculator timeout", 504)],
    ["a 5xx response", new CdekApiError("calculator unavailable", 502)],
    ["an arbitrary 400 response", new CdekApiError("calculator rejected request", 400)],
  ])("preserves a resolved city cache when the calculator returns %s", async (_caseName, calculatorError) => {
    const cityCache = cityResolutionRegistry()
    let cacheBeforeCalculation: any[] = []
    const registry = {
      ...cityCache.registry,
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: true }]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: {
          sender: { city: "Москва", postal_code: "101000" },
          contract_type: "online_store",
          tariff_codes: [136],
        },
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 400, length_mm: 300, width_mm: 200, height_mm: 150,
      }),
    }
    const client = {
      findCities: jest.fn().mockResolvedValue([cdekCityCandidate]),
      calculateTariffs: jest.fn(async () => {
        cacheBeforeCalculation = structuredClone(cityCache.records)
        throw calculatorError
      }),
    }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: {}, logger } as any,
      { client: client as any }
    )

    await expect(service.calculateAvailableTariffs({
      shipping_address: { country_code: "RU", city: "Тула", postal_code: "300000" },
      items: [{ quantity: 1, variant: { weight: 250 } }],
    } as any)).rejects.toBe(calculatorError)

    expect(cityCache.records).toEqual(cacheBeforeCalculation)
    expect(cityCache.records).toEqual([expect.objectContaining({
      country_code: "RU",
      city: "тула",
      postal_code: "300000",
      city_code: 123,
      candidate: cdekCityCandidate,
    })])
    expect(cityCache.registry.createShippingCdekCityResolutionCaches).toHaveBeenCalledTimes(1)
    expect(cityCache.registry.listShippingCdekCityResolutionCaches).toHaveBeenCalledTimes(2)
    expect(client.findCities).toHaveBeenCalledTimes(1)
    expect(client.calculateTariffs).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(
      `event=cdek_calculator_error error_message=\"${calculatorError.message}\"`
    ))
  })

  it("treats an invalid city-code-looking calculator rejection as a general failure", async () => {
    const cached = {
      country_code: "RU",
      city: "тула",
      region: "",
      postal_code: "300000",
      city_code: 123,
      candidate: cdekCityCandidate,
    }
    const cityCache = cityResolutionRegistry([cached])
    const cacheBeforeCalculation = structuredClone(cityCache.records)
    const registry = {
      ...cityCache.registry,
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: true }]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: {
          sender: { city: "Москва", postal_code: "101000" },
          contract_type: "online_store",
          tariff_codes: [136],
        },
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 400, length_mm: 300, width_mm: 200, height_mm: 150,
      }),
    }
    const calculatorError = new CdekApiError(
      'calculator rejected city code: {"code":"invalid_city_code"}',
      400
    )
    const client = {
      findCities: jest.fn(),
      calculateTariffs: jest.fn().mockRejectedValue(calculatorError),
    }
    const logger = cdekLogger()
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: {}, logger } as any,
      { client: client as any }
    )

    await expect(service.calculateAvailableTariffs({
      shipping_address: { country_code: "RU", city: "Тула", postal_code: "300000" },
      items: [{ quantity: 1, variant: { weight: 250 } }],
    } as any)).rejects.toBe(calculatorError)

    expect(cityCache.records).toEqual(cacheBeforeCalculation)
    expect(cityCache.registry.listShippingCdekCityResolutionCaches).toHaveBeenCalledTimes(1)
    expect(client.findCities).not.toHaveBeenCalled()
    expect(client.calculateTariffs).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(
      "event=cdek_calculator_error"
    ))
  })

  it("keeps pickup delivery_point separate from city resolution", async () => {
    let shipment: any
    const registry = {
      listShippingShipments: jest.fn().mockResolvedValue([]),
      claimShippingShipment: jest.fn(async (input) => {
        shipment = { id: "shipment_1", ...input, status: "creating" }
        return { shipment, created: true }
      }),
      updateShippingShipments: jest.fn(async (input) => shipment = { ...shipment, ...input }),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: { sender: { city: "Москва" }, contract_type: "online_store" },
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 400, length_mm: 300, width_mm: 200, height_mm: 150,
      }),
    }
    const client = {
      findCities: jest.fn(),
      createOrder: jest.fn().mockResolvedValue({ uuid: "uuid-1", cdek_number: null }),
      confirmOrderCreation: jest.fn().mockResolvedValue({ uuid: "uuid-1", cdek_number: "track-1" }),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: { execute: async (_key, work) => work() } } as any,
      { client: client as any }
    )

    await service.createFulfillment(
      { cdekData: { tariff_code: 136, point_code: "PVZ-1" } },
      [{ title: "Краска", quantity: 1 }] as any,
      {
        id: "order_1",
        shipping_address: { id: "address_1", first_name: "Иван", phone: "+79990000000", city: "Тула" },
      } as any,
      { id: "fulfillment_1" }
    )

    expect(client.createOrder).toHaveBeenCalledWith(
      { client_id: "id", client_secret: "secret" },
      expect.objectContaining({ delivery_point: "PVZ-1" })
    )
    expect(client.findCities).not.toHaveBeenCalled()
  })

  it("persists a created shipment and reuses it on a duplicate attempt", async () => {
    const createdShipment = {
      id: "ship_1", order_id: "order_1", provider_key: "cdek_cdek", status: "creating",
      provider_shipment_id: null, tracking_number: null, error_message: null,
    }
    let storedShipment: any = null
    const registry = {
      listShippingShipments: jest.fn(async () => storedShipment ? [storedShipment] : []),
      claimShippingShipment: jest.fn(async () => {
        storedShipment = { ...createdShipment }
        return { shipment: storedShipment, created: true }
      }),
      updateShippingShipments: jest.fn(async (input) => {
        storedShipment = { ...storedShipment, ...input }
        return storedShipment
      }),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: { sender: { city: "Москва" }, contract_type: "online_store" },
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 400, length_mm: 300, width_mm: 200, height_mm: 150,
      }),
    }
    const locking = { execute: jest.fn(async (_key, job) => job()) }
    const client = {
      createOrder: jest.fn().mockResolvedValue({ uuid: "uuid-1", cdek_number: null }),
      confirmOrderCreation: jest.fn().mockResolvedValue({ uuid: "uuid-1", cdek_number: "track-1" }),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking } as any,
      { client: client as any }
    )
    const data = { cdekData: { tariff_code: 136 } }
    const items = [{ title: "Краска", sku: "SKU-1", line_item_id: "item_1", quantity: 1 }]
    const order = {
      id: "order_1", display_id: 1,
      shipping_address: { id: "address_1", first_name: "Иван", last_name: "Иванов", phone: "+79990000000", city: "Тула" },
    }
    const fulfillment = { id: "fulfillment_1" }

    await expect(service.createFulfillment(data, items as any, order as any, fulfillment)).resolves.toMatchObject({
      data: { cdek_uuid: "uuid-1", tracking_number: "track-1" },
    })
    await service.createFulfillment(data, items as any, order as any, fulfillment)

    expect(client.createOrder).toHaveBeenCalledTimes(1)
    expect(registry.claimShippingShipment).toHaveBeenCalledWith({
      order_id: "order_1",
      provider_key: "cdek_cdek",
      business_action_id: "fulfillment_1",
      direction: "forward",
      destination_key: "address_1",
    })
    expect(storedShipment).toMatchObject({ status: "created", tracking_number: "track-1" })
  })

  it("omits to_location entirely when a pickup point is set, since CDEK rejects both", async () => {
    const registry = {
      listShippingShipments: jest.fn().mockResolvedValue([]),
      claimShippingShipment: jest.fn().mockResolvedValue({
        shipment: {
          id: "ship_1", order_id: "order_1", provider_key: "cdek_cdek", status: "creating",
          provider_shipment_id: null, tracking_number: null, error_message: null,
        },
        created: true,
      }),
      updateShippingShipments: jest.fn().mockResolvedValue({ id: "ship_1" }),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: { sender: { city: "Москва" }, contract_type: "online_store" },
      }),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 400, length_mm: 300, width_mm: 200, height_mm: 150,
      }),
    }
    const locking = { execute: jest.fn(async (_key, job) => job()) }
    const client = {
      createOrder: jest.fn().mockResolvedValue({ uuid: "uuid-2", cdek_number: null }),
      confirmOrderCreation: jest.fn().mockResolvedValue({ uuid: "uuid-2", cdek_number: "track-2" }),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking } as any,
      { client: client as any }
    )
    const data = { cdekData: { tariff_code: 136, point_code: "MOS4" } }
    const items = [{ title: "Краска", sku: "SKU-1", line_item_id: "item_1", quantity: 1 }]
    const order = {
      id: "order_1", display_id: 29,
      shipping_address: {
        id: "address_1", first_name: "Иван", last_name: "Иванов", phone: "+79990000000",
        city: "Москва", address_1: "кв. 12",
      },
    }
    const fulfillment = { id: "fulfillment_1" }

    await service.createFulfillment(data, items as any, order as any, fulfillment)

    const [, payload] = client.createOrder.mock.calls[0]
    expect(payload).toMatchObject({ delivery_point: "MOS4" })
    expect(payload).not.toHaveProperty("to_location")
  })

  it("uses the shipment returned by a concurrent identity claim without creating in CDEK", async () => {
    const registry = {
      listShippingShipments: jest.fn().mockResolvedValue([]),
      claimShippingShipment: jest.fn().mockResolvedValue({
        created: false,
        shipment: {
          id: "ship_winner", direction: "forward", status: "created",
          provider_shipment_id: "winner-uuid", tracking_number: "winner-track",
        },
      }),
    }
    const client = { createOrder: jest.fn() }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: { execute: async (_key, job) => job() } } as any,
      { client: client as any }
    )

    await expect(service.createFulfillment(
      {}, [], { id: "order_1", shipping_address: { id: "address_1" } } as any,
      { id: "fulfillment_1" }
    )).resolves.toMatchObject({
      data: { cdek_uuid: "winner-uuid", tracking_number: "winner-track" },
    })
    expect(client.createOrder).not.toHaveBeenCalled()
  })

  it("uses the order as the deterministic destination when Medusa strips the address id", async () => {
    const registry = {
      listShippingShipments: jest.fn().mockResolvedValue([]),
      claimShippingShipment: jest.fn().mockResolvedValue({
        created: false,
        shipment: {
          id: "ship_order-fallback", direction: "forward", status: "created",
          provider_shipment_id: "fallback-uuid", tracking_number: "fallback-track",
        },
      }),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: { execute: async (_key, job) => job() } } as any,
      { client: { createOrder: jest.fn() } as any }
    )

    await expect(service.createFulfillment(
      {}, [], { id: "order_1", shipping_address: {} } as any,
      { id: "fulfillment_1" }
    )).resolves.toMatchObject({ data: { cdek_uuid: "fallback-uuid" } })
    expect(registry.claimShippingShipment).toHaveBeenCalledWith(expect.objectContaining({
      destination_key: "order:order_1",
    }))
  })

  it("reuses the forward shipment when a return shipment is listed first", async () => {
    const registry = {
      listShippingShipments: jest.fn().mockResolvedValue([
        { id: "return_1", direction: "return", status: "created", provider_shipment_id: "return-uuid" },
        {
          id: "forward_1", direction: "forward", status: "created",
          provider_shipment_id: "forward-uuid", tracking_number: "forward-track",
        },
      ]),
    }
    const client = { createOrder: jest.fn() }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: { execute: async (_key, job) => job() } } as any,
      { client: client as any }
    )

    await expect(service.createFulfillment({}, [], { id: "order_1" } as any, {}))
      .resolves.toMatchObject({
        data: { cdek_uuid: "forward-uuid", tracking_number: "forward-track" },
      })
    expect(registry.listShippingShipments).toHaveBeenCalledWith({
      order_id: "order_1",
      provider_key: "cdek_cdek",
      direction: "forward",
    })
    expect(client.createOrder).not.toHaveBeenCalled()
  })

  it("persists the error before rethrowing a failed CDEK request", async () => {
    let storedShipment: any
    const registry = {
      listShippingShipments: jest.fn().mockResolvedValue([]),
      claimShippingShipment: jest.fn(async (input) => {
        storedShipment = { id: "ship_1", ...input }
        return { shipment: storedShipment, created: true }
      }),
      updateShippingShipments: jest.fn(async (input) => storedShipment = { ...storedShipment, ...input }),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: { sender: { city: "Москва" }, contract_type: "delivery" },
      }),
      getStorePackage: jest.fn().mockResolvedValue({ weight_grams: 400, length_mm: 100, width_mm: 100, height_mm: 100 }),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: { execute: async (_key, job) => job() } } as any,
      { client: { createOrder: jest.fn().mockRejectedValue(new Error("CDEK unavailable")) } as any }
    )

    await expect(service.createFulfillment(
      { cdekData: { tariff_code: 136 } },
      [{ title: "Краска", quantity: 1 }] as any,
      { id: "order_1", shipping_address: { id: "address_1", first_name: "Иван", phone: "+79990000000", city: "Тула" } } as any,
      { id: "fulfillment_1" }
    )).rejects.toThrow("CDEK unavailable")
    expect(storedShipment).toMatchObject({ status: "failed", error_message: "CDEK unavailable" })
  })

  it("does not store a shipment CDEK rejected after queueing it", async () => {
    let storedShipment: any
    const registry = {
      listShippingShipments: jest.fn().mockResolvedValue([]),
      claimShippingShipment: jest.fn(async (input) => {
        storedShipment = { id: "ship_1", ...input }
        return { shipment: storedShipment, created: true }
      }),
      updateShippingShipments: jest.fn(async (input) => storedShipment = { ...storedShipment, ...input }),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: { sender: { city: "Москва" }, contract_type: "delivery" },
      }),
      getStorePackage: jest.fn().mockResolvedValue({ weight_grams: 400, length_mm: 100, width_mm: 100, height_mm: 100 }),
    }
    const client = {
      createOrder: jest.fn().mockResolvedValue({ uuid: "uuid-1", cdek_number: null }),
      confirmOrderCreation: jest.fn().mockRejectedValue(
        new CdekApiError("Не указан пункт выдачи получателя", 502, false)
      ),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: { execute: async (_key, job) => job() } } as any,
      { client: client as any }
    )

    await expect(service.createFulfillment(
      { cdekData: { tariff_code: 136 } },
      [{ title: "Краска", quantity: 1 }] as any,
      { id: "order_1", shipping_address: { id: "address_1", first_name: "Иван", phone: "+79990000000", city: "Тула" } } as any,
      { id: "fulfillment_1" }
    )).rejects.toThrow("Не указан пункт выдачи получателя")
    expect(storedShipment).toMatchObject({
      status: "failed",
      error_message: "Не указан пункт выдачи получателя",
    })
    expect(storedShipment.tracking_number ?? null).toBeNull()
  })

  it("reconciles an ambiguous creating state instead of repeating POST /orders", async () => {
    let storedShipment: any = {
      id: "ship_1", order_id: "order_1", provider_key: "cdek_cdek", status: "creating",
      provider_shipment_id: null, tracking_number: null, error_message: null,
    }
    const registry = {
      listShippingShipments: jest.fn(async () => [storedShipment]),
      updateShippingShipments: jest.fn(async (input) => storedShipment = { ...storedShipment, ...input }),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: {},
      }),
    }
    const client = {
      findOrderByNumber: jest.fn().mockResolvedValue({ uuid: "uuid-recovered", cdek_number: null }),
      createOrder: jest.fn(),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: { execute: async (_key, job) => job() } } as any,
      { client: client as any }
    )

    await expect(service.createFulfillment(
      { cdekData: { tariff_code: 136 } }, [], { id: "order_1" } as any, {}
    )).resolves.toMatchObject({ data: { cdek_uuid: "uuid-recovered", tracking_number: null } })
    expect(client.createOrder).not.toHaveBeenCalled()
    expect(storedShipment).toMatchObject({ status: "created", provider_shipment_id: "uuid-recovered", tracking_number: null })
  })

  it("reconciles a timed-out POST before a retry can send another POST", async () => {
    let storedShipment: any = null
    const registry = {
      listShippingShipments: jest.fn(async () => storedShipment ? [storedShipment] : []),
      claimShippingShipment: jest.fn(async (input) => {
        storedShipment = { id: "ship_1", ...input }
        return { shipment: storedShipment, created: true }
      }),
      updateShippingShipments: jest.fn(async (input) => storedShipment = { ...storedShipment, ...input }),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: { sender: { city: "Москва" }, contract_type: "delivery" },
      }),
      getStorePackage: jest.fn().mockResolvedValue({ weight_grams: 400, length_mm: 100, width_mm: 100, height_mm: 100 }),
    }
    const client = {
      createOrder: jest.fn().mockRejectedValueOnce(
        new CdekApiError("timeout", 502, true)
      ),
      findOrderByNumber: jest.fn().mockResolvedValue({
        uuid: "uuid-accepted", cdek_number: "track-accepted",
      }),
    }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: { execute: async (_key, job) => job() } } as any,
      { client: client as any }
    )
    const args = [
      { cdekData: { tariff_code: 136 } },
      [{ title: "Краска", quantity: 1 }],
      { id: "order_1", shipping_address: { id: "address_1", first_name: "Иван", phone: "+79990000000", city: "Тула" } },
      { id: "fulfillment_1" },
    ] as const

    await expect(service.createFulfillment(args[0], args[1] as any, args[2] as any, args[3]))
      .rejects.toThrow("timeout")
    expect(storedShipment).toMatchObject({ status: "failed", reconciliation_required: true })

    await expect(service.createFulfillment(args[0], args[1] as any, args[2] as any, args[3]))
      .resolves.toMatchObject({ data: { cdek_uuid: "uuid-accepted", tracking_number: "track-accepted" } })
    expect(client.createOrder).toHaveBeenCalledTimes(1)
    expect(client.findOrderByNumber).toHaveBeenCalledWith(
      { client_id: "id", client_secret: "secret" }, "order_1"
    )
  })

  it("keeps reconciling after a temporary negative lookup and never repeats POST", async () => {
    let storedShipment: any = {
      id: "ship_1", order_id: "order_1", provider_key: "cdek_cdek", status: "failed",
      reconciliation_required: true, provider_shipment_id: null, tracking_number: null,
    }
    const registry = {
      listShippingShipments: jest.fn(async () => [storedShipment]),
      updateShippingShipments: jest.fn(async (input) => storedShipment = { ...storedShipment, ...input }),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
        configuration: {},
      }),
    }
    const client = { findOrderByNumber: jest.fn().mockResolvedValue(null), createOrder: jest.fn() }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry, locking: { execute: async (_key, job) => job() } } as any,
      { client: client as any }
    )

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(service.createFulfillment({}, [], { id: "order_1" } as any, {}))
        .rejects.toThrow("Повторите сверку позже")
    }
    expect(client.findOrderByNumber).toHaveBeenCalledTimes(2)
    expect(client.createOrder).not.toHaveBeenCalled()
    expect(storedShipment).toMatchObject({ reconciliation_required: true })
  })

  it("cancels a placed shipment remotely before changing its local status", async () => {
    const shipment: any = {
      id: "ship_1",
      provider_shipment_id: "uuid-1",
      simplified_status: "placed",
    }
    const registry = {
      listShippingShipments: jest.fn().mockResolvedValue([shipment]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
      }),
      updateShippingShipments: jest.fn(async (input) => Object.assign(shipment, input)),
    }
    const client = { deleteOrder: jest.fn().mockResolvedValue(undefined) }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry } as any,
      { client: client as any }
    )

    await service.cancelFulfillment({ cdek_uuid: "uuid-1" })

    expect(client.deleteOrder).toHaveBeenCalledWith(
      { client_id: "id", client_secret: "secret" },
      "uuid-1"
    )
    expect(shipment.simplified_status).toBe("cancelled")
  })

  it("keeps the shipment unchanged when CDEK rejects cancellation", async () => {
    const shipment = {
      id: "ship_1",
      provider_shipment_id: "uuid-1",
      simplified_status: "placed",
    }
    const registry = {
      listShippingShipments: jest.fn().mockResolvedValue([shipment]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "id", client_secret: "secret" }),
      }),
      updateShippingShipments: jest.fn(),
    }
    const client = { deleteOrder: jest.fn().mockRejectedValue(new Error("carrier rejected")) }
    const service = new CdekFulfillmentService(
      { shippingProviderRegistry: registry } as any,
      { client: client as any }
    )

    await expect(service.cancelFulfillment({ cdek_uuid: "uuid-1" }))
      .rejects.toThrow("carrier rejected")
    expect(registry.updateShippingShipments).not.toHaveBeenCalled()
    expect(shipment.simplified_status).toBe("placed")
  })
})
