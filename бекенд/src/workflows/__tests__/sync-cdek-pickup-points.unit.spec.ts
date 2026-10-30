jest.mock("../../modules/shipping-provider-registry/credentials", () => ({
  decryptShippingProviderCredentials: jest.fn(() => ({
    client_id: "client",
    client_secret: "secret",
  })),
}))

import {
  CDEK_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../modules/shipping-provider-registry"
import { syncCdekPickupPoints } from "../sync-cdek-pickup-points"

function harness(
  overrides: Record<string, unknown> = {},
  carrier = { listPickupPoints: jest.fn() }
) {
  const service = {
    listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: true }]),
    getProviderConfig: jest.fn().mockResolvedValue({ encrypted_credentials: "encrypted" }),
    listCdekPickupPoints: carrier.listPickupPoints,
    listShippingPickupPoints: jest.fn().mockResolvedValue([]),
    createShippingPickupPoints: jest.fn(),
    restoreShippingPickupPoints: jest.fn(),
    updateShippingPickupPoints: jest.fn(),
    deleteShippingPickupPoints: jest.fn(),
    ...overrides,
  }
  return {
    service,
    container: {
      resolve: jest.fn(() => service),
    } as any,
  }
}

const points = [
  {
    code: "MSK/1",
    name: "ПВЗ 1",
    location: {
      city: "Москва",
      city_code: 44,
      address: "Ленина, 1",
      address_full: "Россия, Москва, Ленина, 1",
      latitude: 55.7,
      longitude: 37.6,
    },
    work_time: "Пн-Вс",
    type: "PVZ",
  },
  {
    code: "MSK-2",
    name: "ПВЗ 2",
    location: {
      city: "Москва",
      city_code: 44,
      address: "Тверская, 2",
      latitude: 55.8,
      longitude: 37.7,
    },
    work_time: "Пн-Пт",
    type: "POSTAMAT",
  },
]

it("skips synchronization when CDEK is hidden or has no credentials", async () => {
  const carrier = { listPickupPoints: jest.fn() }
  const hidden = harness({
    listShippingProviderVisibilities: jest.fn().mockResolvedValue([]),
  }, carrier)
  await expect(syncCdekPickupPoints(hidden.container))
    .resolves.toEqual({ synced: 0, skipped: true })
  expect(carrier.listPickupPoints).not.toHaveBeenCalled()

  const disabled = harness({
    listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: false }]),
  }, carrier)
  await expect(syncCdekPickupPoints(disabled.container))
    .resolves.toEqual({ synced: 0, skipped: true })

  const unconfigured = harness({ getProviderConfig: jest.fn().mockResolvedValue(null) }, carrier)
  await expect(syncCdekPickupPoints(unconfigured.container))
    .resolves.toEqual({ synced: 0, skipped: true })
})

it("creates, restores, updates and soft-deletes the exact provider snapshot", async () => {
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({
    id: index === 0 ? "cdek_MSK_1" : `old_${index}`,
    provider_key: CDEK_PROVIDER_KEY,
    deleted_at: index === 0 ? new Date("2026-01-01") : null,
  }))
  const secondPage = [{ id: "cdek_MSK-2", provider_key: CDEK_PROVIDER_KEY, deleted_at: null }]
  const list = jest.fn()
    .mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce(secondPage)
  const carrier = { listPickupPoints: jest.fn().mockResolvedValue(points) }
  const { container, service } = harness({ listShippingPickupPoints: list }, carrier)

  await expect(syncCdekPickupPoints(container)).resolves.toEqual({
    synced: 2,
    removed: 999,
    skipped: false,
  })
  expect(carrier.listPickupPoints).toHaveBeenCalledWith({
    client_id: "client",
    client_secret: "secret",
  })
  expect(container.resolve).toHaveBeenCalledTimes(1)
  expect(container.resolve).toHaveBeenCalledWith(SHIPPING_PROVIDER_REGISTRY_MODULE)
  expect(list).toHaveBeenNthCalledWith(1,
    { provider_key: CDEK_PROVIDER_KEY },
    { take: 1000, skip: 0, withDeleted: true },
  )
  expect(list).toHaveBeenNthCalledWith(2,
    { provider_key: CDEK_PROVIDER_KEY },
    { take: 1000, skip: 1000, withDeleted: true },
  )
  expect(service.createShippingPickupPoints).not.toHaveBeenCalled()
  expect(service.restoreShippingPickupPoints).toHaveBeenCalledWith(["cdek_MSK_1"])
  expect(service.updateShippingPickupPoints).toHaveBeenCalledWith([
    expect.objectContaining({
      id: "cdek_MSK_1",
      external_id: "MSK/1",
      address: "Россия, Москва, Ленина, 1",
    }),
    expect.objectContaining({
      id: "cdek_MSK-2",
      address: "Тверская, 2",
    }),
  ])
  expect(service.deleteShippingPickupPoints).toHaveBeenCalledWith(
    expect.arrayContaining(["old_1", "old_999"]),
  )
})

it("creates a fresh snapshot and performs no empty mutations", async () => {
  const carrier = { listPickupPoints: jest.fn().mockResolvedValue(points.slice(0, 1)) }
  const freshWithCarrier = harness({}, carrier)
  await syncCdekPickupPoints(freshWithCarrier.container)
  expect(freshWithCarrier.service.createShippingPickupPoints).toHaveBeenCalledWith([
    expect.objectContaining({ id: "cdek_MSK_1" }),
  ])
  expect(freshWithCarrier.service.restoreShippingPickupPoints).not.toHaveBeenCalled()
  expect(freshWithCarrier.service.updateShippingPickupPoints).not.toHaveBeenCalled()
  expect(freshWithCarrier.service.deleteShippingPickupPoints).not.toHaveBeenCalled()
})

it("does not create duplicate points when synchronization is repeated", async () => {
  const carrier = { listPickupPoints: jest.fn().mockResolvedValue(points) }
  const list = jest.fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(points.map((point) => ({
      id: `cdek_${point.code.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      deleted_at: null,
    })))
  const { container, service } = harness({ listShippingPickupPoints: list }, carrier)

  await syncCdekPickupPoints(container)
  await syncCdekPickupPoints(container)

  expect(service.createShippingPickupPoints).toHaveBeenCalledTimes(1)
})
