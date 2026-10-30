import { normalizeStorePickupOption } from "../../../api/catalog/shipping/utils"
import { resolveStorePickupSelection } from "../prepare-catalog-shipping-selection"
import { planStorePickupShippingOptions } from "../ensure-store-pickup-shipping-options"

const settings = {
  id: "default",
  address: " Магазин, улица 1 ",
  hours: " 09:00–18:00 ",
  is_enabled: true,
}

const pickup = (id: string, zone: string, profile: string, deleted_at: string | null = null) => ({
  id,
  service_zone_id: zone,
  shipping_profile_id: profile,
  provider_id: "manual_manual",
  data: { store_pickup: true },
  deleted_at,
})

describe("store pickup shipping options", () => {
  it("plans exactly one option for every zone/profile pair and is idempotent", () => {
    const sources = [
      { id: "courier-1", service_zone_id: "zone-1", shipping_profile_id: "profile-1" },
      { id: "courier-duplicate", service_zone_id: "zone-1", shipping_profile_id: "profile-1" },
      { id: "courier-2", service_zone_id: "zone-2", shipping_profile_id: "profile-2" },
    ]
    expect(planStorePickupShippingOptions(sources, [])).toEqual({
      duplicateIds: [],
      restoreIds: [],
      missingPairs: [
        { service_zone_id: "zone-1", shipping_profile_id: "profile-1" },
        { service_zone_id: "zone-2", shipping_profile_id: "profile-2" },
      ],
    })
    expect(planStorePickupShippingOptions(sources, [
      pickup("pickup-1", "zone-1", "profile-1"),
      pickup("pickup-2", "zone-2", "profile-2"),
    ])).toEqual({ duplicateIds: [], restoreIds: [], missingPairs: [] })
  })

  it("removes active duplicates and restores a disabled option instead of creating one", () => {
    const sources = [{ id: "carrier", service_zone_id: "zone", shipping_profile_id: "profile" }]
    expect(planStorePickupShippingOptions(sources, [
      pickup("keep", "zone", "profile"),
      pickup("duplicate", "zone", "profile"),
    ])).toMatchObject({ duplicateIds: ["duplicate"], missingPairs: [] })
    expect(planStorePickupShippingOptions(sources, [
      pickup("restore", "zone", "profile", "2026-09-10"),
    ])).toMatchObject({ restoreIds: ["restore"], missingPairs: [] })
  })

  it("selects pickup for every shipping profile and snapshots current details", () => {
    const result = resolveStorePickupSelection(settings, ["profile-1", "profile-2"], [
      pickup("pickup-1", "zone", "profile-1"),
      pickup("pickup-2", "zone", "profile-2"),
    ])
    expect(result.options).toEqual([
      { id: "pickup-1", data: { store_pickup: { address: "Магазин, улица 1", hours: "09:00–18:00" } } },
      { id: "pickup-2", data: { store_pickup: { address: "Магазин, улица 1", hours: "09:00–18:00" } } },
    ])
  })

  it("fails instead of leaving any profile without shipping", () => {
    expect(() => resolveStorePickupSelection(settings, ["profile-1", "profile-2"], [
      pickup("pickup-1", "zone", "profile-1"),
    ])).toThrow("недоступен для части товаров")
  })

  it("normalizes a zero-price option without a carrier quote", () => {
    expect(normalizeStorePickupOption(settings, [pickup("pickup", "zone", "profile")])).toMatchObject({
      id: "store-pickup",
      type: "store_pickup",
      price: 0,
      pickup_address: "Магазин, улица 1",
      pickup_hours: "09:00–18:00",
    })
    expect(normalizeStorePickupOption({ ...settings, is_enabled: false }, [pickup("pickup", "zone", "profile")])).toBeNull()
  })
})
