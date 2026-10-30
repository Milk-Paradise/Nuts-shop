jest.mock("../../modules/shipping-provider-registry/credentials", () => ({
  decryptShippingProviderCredentials: jest.fn(() => ({ client_id: "client", client_secret: "secret" })),
}))

import {
  OZON_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../modules/shipping-provider-registry"
import { syncOzonPickupPoints } from "../sync-ozon-pickup-points"

function harness(
  overrides: Record<string, unknown> = {},
  carrier = { listPickupPoints: jest.fn() }
) {
  const service = {
    listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: true }]),
    getProviderConfig: jest.fn().mockResolvedValue({ encrypted_credentials: "encrypted" }),
    listOzonPickupPoints: carrier.listPickupPoints,
    listShippingPickupPoints: jest.fn().mockResolvedValue([]),
    createShippingPickupPoints: jest.fn(), restoreShippingPickupPoints: jest.fn(),
    updateShippingPickupPoints: jest.fn(), deleteShippingPickupPoints: jest.fn(), ...overrides,
  }
  return {
    service,
    container: {
      resolve: jest.fn(() => service),
    } as any,
  }
}

const points = [{ id: "point/1", name: "ПВЗ", address: "Москва, 1", city: "Москва", latitude: 55.7, longitude: 37.6, working_hours: "09:00-21:00" }]

it("skips hidden or unconfigured Ozon", async () => {
  const carrier = { listPickupPoints: jest.fn() }
  await expect(syncOzonPickupPoints(harness({ listShippingProviderVisibilities: jest.fn().mockResolvedValue([]) }, carrier).container)).resolves.toEqual({ synced: 0, skipped: true })
  await expect(syncOzonPickupPoints(harness({ getProviderConfig: jest.fn().mockResolvedValue(null) }, carrier).container)).resolves.toEqual({ synced: 0, skipped: true })
  expect(carrier.listPickupPoints).not.toHaveBeenCalled()
})

it("creates a provider-scoped snapshot and normalizes point ids", async () => {
  const carrier = { listPickupPoints: jest.fn().mockResolvedValue(points) }
  const { container, service } = harness({}, carrier)
  await expect(syncOzonPickupPoints(container)).resolves.toEqual({ synced: 1, removed: 0, skipped: false })
  expect(carrier.listPickupPoints).toHaveBeenCalledWith({ client_id: "client", client_secret: "secret" })
  expect(container.resolve).toHaveBeenCalledTimes(1)
  expect(container.resolve).toHaveBeenCalledWith(SHIPPING_PROVIDER_REGISTRY_MODULE)
  expect(service.createShippingPickupPoints).toHaveBeenCalledWith([expect.objectContaining({
    id: "ozon_point_1", provider_key: OZON_PROVIDER_KEY, external_id: "point/1", city: "Москва",
  })])
})

it("soft-deletes stale points", async () => {
  const carrier = { listPickupPoints: jest.fn().mockResolvedValue([]) }
  const { container, service } = harness({ listShippingPickupPoints: jest.fn().mockResolvedValue([{ id: "ozon_old", deleted_at: null }]) }, carrier)
  await syncOzonPickupPoints(container)
  expect(service.deleteShippingPickupPoints).toHaveBeenCalledWith(["ozon_old"])
})

it("does not create duplicate points when synchronization is repeated", async () => {
  const carrier = { listPickupPoints: jest.fn().mockResolvedValue(points) }
  const list = jest.fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "ozon_point_1", deleted_at: null }])
  const { container, service } = harness({ listShippingPickupPoints: list }, carrier)

  await syncOzonPickupPoints(container)
  await syncOzonPickupPoints(container)

  expect(service.createShippingPickupPoints).toHaveBeenCalledTimes(1)
})
