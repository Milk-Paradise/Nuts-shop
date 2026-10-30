const mockWorkflowRun = jest.fn()
const mockCdekCalculateTariffs = jest.fn()
const mockOzonCalculateTariffs = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => ({
  listShippingOptionsForCartWorkflow: jest.fn(() => ({ run: mockWorkflowRun })),
  listShippingOptionsForCartWithPricingWorkflow: jest.fn(() => ({ run: mockWorkflowRun })),
}))

jest.mock("../../../../modules/shipping-provider-registry/cdek-client", () => ({
  CdekClient: jest.fn(() => ({ calculateTariffs: mockCdekCalculateTariffs })),
}))

jest.mock("../../../../providers/fulfillment-ozon/service", () => ({
  __esModule: true,
  default: jest.fn(() => ({ calculateAvailableTariffs: mockOzonCalculateTariffs })),
}))

import {
  dedupeCheapestById,
  listNormalizedPickupPointCatalog,
  listConnectedShippingServices,
  listNormalizedPickupPoints,
  listNormalizedShippingOptionsWithErrors,
  listPublicShippingTariffs,
  resolveShippingSelection,
} from "../utils"
import { encryptShippingProviderCredentials } from "../../../../modules/shipping-provider-registry/credentials"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

beforeEach(() => {
  jest.clearAllMocks()
  process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "shipping-utils-test-key"
})

function containerWith(registry: any) {
  registry.getProviderConfig ??= jest.fn().mockImplementation(async (providerKey: string) => ({
    encrypted_credentials: encryptShippingProviderCredentials({ client_id: "client", client_secret: "secret" }),
    configuration: providerKey === "cdek_cdek"
      ? {
          sender: { city: "Тула", street: "Ленина, 1", postal_code: "300000", contact_name: "Иван", phone: "+70000000000" },
          contract_type: "delivery",
          tariff_codes: [136],
        }
      : {},
  }))
  registry.getStorePackage ??= jest.fn().mockResolvedValue({
    weight_grams: 1_000,
    length_mm: 300,
    width_mm: 200,
    height_mm: 150,
  })
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return {
    resolve: jest.fn((key: string) => (key === ContainerRegistrationKeys.LOGGER ? logger : registry)),
  } as any
}

describe("direct provider shipping options", () => {
  it("normalizes CDEK and Ozon quotes", async () => {
    const registry = {
      listShippingProviderVisibilities: jest.fn(({ provider_key }) => Promise.resolve([
        { provider_key, is_visible: provider_key === "cdek_cdek" || provider_key === "ozon_ozon" },
      ])),
      listStorePickupSettings: jest.fn().mockResolvedValue([]),
    }
    mockWorkflowRun
      .mockResolvedValueOnce({ result: [
        { id: "cdek-pickup", provider_id: "cdek_cdek", data: { delivery_type: "pickup" } },
        { id: "ozon-pickup", provider_id: "ozon_ozon", data: { delivery_type: "pickup" } },
      ] })
      .mockResolvedValueOnce({ result: [
        { id: "cdek-pickup", provider_id: "cdek_cdek", data: { delivery_type: "pickup" }, calculated_price: { data: { tariff_codes: [{ code: 136, name: "СДЭК ПВЗ", delivery_sum: 300, period_min: 2, period_max: 3 }] } } },
      ] })
      .mockResolvedValueOnce({ result: [
        { id: "ozon-pickup", provider_id: "ozon_ozon", calculated_price: { data: { tariffs: [{ code: "pickup", name: "Ozon ПВЗ", price: 250, delivery_type: "pickup", delivery_days_min: 2, delivery_days_max: 4 }] } } },
      ] })

    const result = await listNormalizedShippingOptionsWithErrors(containerWith(registry), "cart_1")

    expect(result.unavailable_providers).toEqual([])
    expect(result.shipping_options.map(({ provider }) => provider)).toEqual(["ozon", "cdek"])
  })

  it("keeps one cheapest row for duplicate normalized ids", () => {
    expect(dedupeCheapestById([
      { id: "same", name: "expensive", type: "courier", price: 500, days_min: null, days_max: null, provider: "cdek", carrier: "cdek_cdek" },
      { id: "same", name: "cheap", type: "courier", price: 300, days_min: null, days_max: null, provider: "cdek", carrier: "cdek_cdek" },
    ])).toEqual([expect.objectContaining({ name: "cheap" })])
  })
})

describe("public shipping tariffs", () => {
  function tariffRegistry() {
    return {
      listShippingProviderVisibilities: jest.fn(({ provider_key }) => Promise.resolve([
        { provider_key, is_visible: true },
      ])),
      getProviderConfig: jest.fn(async (providerKey: string) => ({
        encrypted_credentials: encryptShippingProviderCredentials({
          client_id: "client",
          client_secret: "secret",
        }),
        configuration: providerKey === "cdek_cdek"
          ? {
              sender: { city: "Тула", street: "Ленина, 1", postal_code: "300000", contact_name: "Иван", phone: "+70000000000" },
              contract_type: "delivery",
              tariff_codes: [136, 137],
            }
          : { sender: { city: "Тула", postal_code: "300000" } },
      })),
      getStorePackage: jest.fn().mockResolvedValue({
        weight_grams: 1_000,
        length_mm: 300,
        width_mm: 200,
        height_mm: 150,
      }),
    }
  }

  it("returns real CDEK and Ozon tariffs for a city without a cart", async () => {
    mockCdekCalculateTariffs.mockResolvedValue([{
      code: 137, name: "СДЭК курьер", description: null, delivery_mode: 1,
      delivery_sum: 600, period_min: 2, period_max: 4,
    }])
    mockOzonCalculateTariffs.mockResolvedValue([{
      code: "ozon-courier", name: "Ozon курьер", price: 500, currency: "RUB",
      type: "courier", delivery_days_min: 1, delivery_days_max: 3,
    }])
    const registry = tariffRegistry()

    await expect(listPublicShippingTariffs(containerWith(registry), {
      city: "Москва", postal_code: "101000",
    })).resolves.toEqual({
      city: "Москва",
      tariffs: [
        {
          provider_key: "cdek_cdek", carrier: "cdek_cdek", tariff_code: 137,
          name: "СДЭК курьер", type: "courier", price: 600, currency_code: "RUB",
          delivery_days_min: 2, delivery_days_max: 4,
        },
        {
          provider_key: "ozon_ozon", carrier: "ozon_ozon", tariff_code: "ozon-courier",
          name: "Ozon курьер", type: "courier", price: 500, currency_code: "RUB",
          delivery_days_min: 1, delivery_days_max: 3,
        },
      ],
      unavailable_providers: [],
    })

    expect(mockCdekCalculateTariffs).toHaveBeenCalledWith(
      { client_id: "client", client_secret: "secret" },
      expect.objectContaining({
        recipient: { city: "Москва", postal_code: "101000" },
        package: { weight_grams: 1_000, length_mm: 300, width_mm: 200, height_mm: 150 },
      })
    )
    expect(mockOzonCalculateTariffs).toHaveBeenCalledWith(
      {
        city: "Москва",
        postal_code: "101000",
        package: { weight_grams: 1_000, length_mm: 300, width_mm: 200, height_mm: 150 },
      }
    )
  })

  it("keeps available tariffs when one provider fails", async () => {
    mockCdekCalculateTariffs.mockRejectedValue(new Error("CDEK unavailable"))
    mockOzonCalculateTariffs.mockResolvedValue([{
      code: "ozon-pickup", name: "Ozon ПВЗ", price: 300, currency: "RUB",
      type: "pickup", delivery_days_min: 2, delivery_days_max: 5,
    }])

    await expect(listPublicShippingTariffs(containerWith(tariffRegistry()), {
      city: "Москва",
    })).resolves.toEqual({
      city: "Москва",
      tariffs: [expect.objectContaining({ provider_key: "ozon_ozon", tariff_code: "ozon-pickup" })],
      unavailable_providers: ["cdek_cdek"],
    })
  })

  it("keeps available tariffs when a provider configuration cannot be read", async () => {
    mockOzonCalculateTariffs.mockResolvedValue([{
      code: "ozon-courier", name: "Ozon курьер", price: 500, currency: "RUB",
      type: "courier", delivery_days_min: 1, delivery_days_max: 3,
    }])
    const registry = tariffRegistry()
    registry.getProviderConfig.mockImplementation(async (providerKey: string) => {
      if (providerKey === "cdek_cdek") throw new Error("CDEK configuration is unavailable")
      return {
        encrypted_credentials: encryptShippingProviderCredentials({
          client_id: "client",
          client_secret: "secret",
        }),
        configuration: { sender: { city: "Тула", postal_code: "300000" } },
      }
    })

    await expect(listPublicShippingTariffs(containerWith(registry), {
      city: "Москва",
    })).resolves.toEqual({
      city: "Москва",
      tariffs: [expect.objectContaining({ provider_key: "ozon_ozon", tariff_code: "ozon-courier" })],
      unavailable_providers: ["cdek_cdek"],
    })
  })
})

describe("pickup point normalization", () => {
  it("returns active CDEK and Ozon points from the shared registry", async () => {
    const registry = {
      listShippingProviderVisibilities: jest.fn(({ provider_key }) => Promise.resolve([
        { provider_key, is_visible: true },
      ])),
      listShippingPickupPoints: jest.fn(async ({ provider_key }) => [{
        external_id: provider_key === "ozon_ozon" ? "point/1" : "MSK1",
        name: provider_key === "ozon_ozon" ? "Ozon ПВЗ" : "СДЭК ПВЗ",
        address: "Москва, 1",
        lat: 55.75,
        lng: 37.61,
        schedule: "10:00-22:00",
      }]),
    }

    const points = await listNormalizedPickupPoints(containerWith(registry), "Москва")

    expect(points.map((point) => point.carrier)).toEqual(["cdek", "ozon_ozon"])
    expect(points).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cdek_cdek:MSK1", provider: "cdek", provider_key: "cdek_cdek", external_id: "MSK1" }),
      expect.objectContaining({ id: "ozon_ozon:point/1", provider: "ozon", provider_key: "ozon_ozon", external_id: "point/1" }),
    ]))
  })

  it("keeps full points, filters map coordinates, and reports a failed source without details", async () => {
    const registry = {
      listShippingProviderVisibilities: jest.fn(({ provider_key }) => Promise.resolve([
        { provider_key, is_visible: true },
      ])),
      listShippingPickupPoints: jest.fn(async ({ provider_key }) => {
        if (provider_key === "ozon_ozon") throw new Error("upstream token should never leak")
        return [
          { external_id: "valid", name: "zero", address: "1", lat: 0, lng: 0, schedule: null },
          { external_id: "null", name: "null", address: "2", lat: null, lng: null, schedule: null },
          { external_id: "nan", name: "nan", address: "3", lat: Number.NaN, lng: 1, schedule: null },
          { external_id: "infinity", name: "infinity", address: "4", lat: Infinity, lng: 1, schedule: null },
          { external_id: "range", name: "range", address: "5", lat: 91, lng: 1, schedule: null },
          { external_id: "lng-range", name: "lng range", address: "6", lat: 1, lng: 181, schedule: null },
        ]
      }),
    }

    const result = await listNormalizedPickupPointCatalog(containerWith(registry), "Москва")

    expect(result.points.map((point) => point.external_id)).toEqual([
      "valid", "null", "nan", "infinity", "range", "lng-range",
    ])
    expect(result.map_points.map((point) => point.external_id)).toEqual(["valid"])
    expect(result.sources).toEqual([
      { provider_key: "cdek_cdek", status: "available" },
      { provider_key: "ozon_ozon", status: "partial" },
    ])
    expect(JSON.stringify(result.sources)).not.toContain("token")
  })

  it("does not read an invisible provider and preserves provider/external identity deduplication", async () => {
    const registry = {
      listShippingProviderVisibilities: jest.fn(({ provider_key }) => Promise.resolve([
        { provider_key, is_visible: provider_key === "cdek_cdek" },
      ])),
      listShippingPickupPoints: jest.fn().mockResolvedValue([
        { external_id: "same", name: "first", address: "1", lat: 1, lng: 1, schedule: null },
        { external_id: "same", name: "last", address: "2", lat: 2, lng: 2, schedule: null },
      ]),
    }

    const result = await listNormalizedPickupPointCatalog(containerWith(registry), "Москва")

    expect(registry.listShippingPickupPoints).toHaveBeenCalledTimes(1)
    expect(result.points).toEqual([expect.objectContaining({
      provider_key: "cdek_cdek", external_id: "same", name: "last",
    })])
    expect(result.sources).toEqual([
      { provider_key: "cdek_cdek", status: "available" },
      { provider_key: "ozon_ozon", status: "unavailable" },
    ])
  })

  it("keeps identical external ids when they belong to different providers", async () => {
    const registry = {
      listShippingProviderVisibilities: jest.fn(({ provider_key }) => Promise.resolve([
        { provider_key, is_visible: true },
      ])),
      listShippingPickupPoints: jest.fn().mockResolvedValue([
        { external_id: "shared-id", name: "ПВЗ", address: "Адрес", lat: 55, lng: 37, schedule: null },
      ]),
    }

    const result = await listNormalizedPickupPointCatalog(containerWith(registry), "Москва")

    expect(result.points.map((point) => point.id)).toEqual([
      "cdek_cdek:shared-id", "ozon_ozon:shared-id",
    ])
  })

  it("returns diagnostic statuses when every active source fails", async () => {
    const registry = {
      listShippingProviderVisibilities: jest.fn(({ provider_key }) => Promise.resolve([
        { provider_key, is_visible: true },
      ])),
      listShippingPickupPoints: jest.fn().mockRejectedValue(new Error("provider failure")),
    }

    await expect(listNormalizedPickupPointCatalog(containerWith(registry), "Москва")).resolves.toEqual({
      points: [],
      map_points: [],
      sources: [
        { provider_key: "cdek_cdek", status: "partial" },
        { provider_key: "ozon_ozon", status: "partial" },
      ],
    })
  })

  it("reads every page instead of truncating the directory at 5000 points", async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      external_id: `point-${index}`, name: "ПВЗ", address: "Адрес", lat: 55, lng: 37, schedule: null,
    }))
    const registry = {
      listShippingProviderVisibilities: jest.fn(({ provider_key }) => Promise.resolve([
        { provider_key, is_visible: provider_key === "cdek_cdek" },
      ])),
      listShippingPickupPoints: jest.fn((_filters, options) => Promise.resolve(
        options.skip === 0 ? firstPage : options.skip === 1_000
          ? [{ external_id: "point-1000", name: "ПВЗ", address: "Адрес", lat: 55, lng: 37, schedule: null }]
          : []
      )),
    }

    const result = await listNormalizedPickupPointCatalog(containerWith(registry), "Москва")

    expect(result.points).toHaveLength(1_001)
    expect(registry.listShippingPickupPoints).toHaveBeenNthCalledWith(
      2, expect.anything(), expect.objectContaining({ skip: 1_000, take: 1_000 })
    )
  })
})

describe("direct provider selection", () => {
  it("creates a CDEK pickup selection with the selected point", () => {
    expect(resolveShippingSelection([
      { id: "so-cdek", provider_id: "cdek_cdek", calculated_price: { data: { tariff_codes: [{ code: 136 }] } } },
    ], "so-cdek:pickup:cdek:136", "cdek_cdek:MSK1", {
      id: "cdek_cdek:MSK1", provider_key: "cdek_cdek", external_id: "MSK1", name: "СДЭК", address: "Москва",
    })).toEqual({
      shippingOptionId: "so-cdek",
      data: {
        cdekData: { tariff_code: 136, point_code: "MSK1" },
        pickup_point: {
          id: "cdek_cdek:MSK1", provider_key: "cdek_cdek", external_id: "MSK1", name: "СДЭК", address: "Москва",
        },
      },
    })
  })

  it("requires the resolved pickup point to match the selected point identity", () => {
    expect(() => resolveShippingSelection([
      { id: "so-cdek", provider_id: "cdek_cdek", calculated_price: { data: { tariff_codes: [{ code: 136 }] } } },
    ], "so-cdek:pickup:cdek:136", "cdek_cdek:MSK1", {
      id: "cdek_cdek:MSK1", provider_key: "cdek_cdek", external_id: "OTHER", name: "СДЭК", address: "Москва",
    })).toThrow("Pickup point provider does not match")
  })

  it("rejects a point id or resolved point for courier selections", () => {
    const shippingOptions = [
      { id: "so-cdek", provider_id: "cdek_cdek", calculated_price: { data: { tariff_codes: [{ code: 137 }] } } },
    ]
    const pickupPoint = {
      id: "cdek_cdek:MSK1", provider_key: "cdek_cdek", external_id: "MSK1", name: "СДЭК", address: "Москва",
    }

    expect(() => resolveShippingSelection(
      shippingOptions, "so-cdek:courier:cdek:137", "cdek_cdek:MSK1"
    )).toThrow("Pickup point data is not allowed for a courier delivery option")
    expect(() => resolveShippingSelection(
      shippingOptions, "so-cdek:courier:cdek:137", undefined, pickupPoint
    )).toThrow("Pickup point data is not allowed for a courier delivery option")
  })

})

describe("connected services", () => {
  it("lists only visible direct providers", async () => {
    const registry = {
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([
        { provider_key: "cdek_cdek", is_visible: true },
        { provider_key: "ozon_ozon", is_visible: true },
      ]),
    }
    await expect(listConnectedShippingServices(containerWith(registry))).resolves.toEqual([
      { provider_key: "cdek_cdek", name: "cdek_cdek" },
      { provider_key: "ozon_ozon", name: "ozon_ozon" },
    ])
  })
})
