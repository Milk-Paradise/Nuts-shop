import {
  isStorePickupAvailable,
  storePickupOrderState,
  storePickupSnapshotFromMethods,
} from "../utils"

describe("store pickup state", () => {
  it("is public only when enabled with a non-blank address", () => {
    expect(isStorePickupAvailable({ is_enabled: true, address: "  Магазин  " })).toBe(true)
    expect(isStorePickupAvailable({ is_enabled: false, address: "Магазин" })).toBe(false)
    expect(isStorePickupAvailable({ is_enabled: true, address: "  " })).toBe(false)
  })

  it("reads the immutable order snapshot, not current settings", () => {
    const order = storePickupOrderState({
      store_pickup: true,
      store_pickup_address: " Старый адрес ",
      store_pickup_hours: " 09:00–18:00 ",
    })
    const currentSettings = { address: "Новый адрес", hours: "круглосуточно" }

    expect(order).toMatchObject({
      address: "Старый адрес",
      hours: "09:00–18:00",
      collected_at: null,
    })
    expect(order?.address).not.toBe(currentSettings.address)
  })

  it("copies the snapshot embedded into every selected shipping method", () => {
    expect(storePickupSnapshotFromMethods([
      { data: {} },
      { data: { store_pickup: { address: "  Склад, 1 ", hours: " 10–20 " } } },
    ])).toEqual({ address: "Склад, 1", hours: "10–20" })
  })
})
