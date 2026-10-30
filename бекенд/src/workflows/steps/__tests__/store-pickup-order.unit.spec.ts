import { buildCheckoutOrderMetadata, resolveMissingProfileShippingOptions } from "../catalog-checkout"
import { collectStorePickupMetadata } from "../mark-store-pickup-collected"

describe("store pickup order lifecycle", () => {
  it("persists a checkout snapshot and clears it after switching back to courier", () => {
    const pickup = buildCheckoutOrderMetadata(
      { name: "Иван", phone: "+7999", city: "Москва", comment: "" },
      {},
      null,
      { address: "Старый адрес", hours: "10–19" }
    )
    expect(pickup).toMatchObject({
      store_pickup: true,
      store_pickup_address: "Старый адрес",
      store_pickup_hours: "10–19",
    })

    const courier = buildCheckoutOrderMetadata(
      { name: "Иван", phone: "+7999", city: "Москва", street: "Ленина", house: "1", comment: "" },
      pickup
    )
    expect(courier).not.toHaveProperty("store_pickup")
    expect(courier).not.toHaveProperty("store_pickup_address")
    expect(courier).toMatchObject({ checkout_address_street: "Ленина", checkout_address_house: "1" })
  })

  it("marks pickup collected idempotently and rejects carrier orders", () => {
    const metadata = { store_pickup: true, store_pickup_address: "Магазин", store_pickup_hours: "10–19" }
    const first = collectStorePickupMetadata(metadata, "2026-09-10T10:00:00.000Z")
    expect(first).toMatchObject({ changed: true, collected_at: "2026-09-10T10:00:00.000Z" })
    const second = collectStorePickupMetadata(first.metadata, "2026-09-11T10:00:00.000Z")
    expect(second).toMatchObject({ changed: false, collected_at: "2026-09-10T10:00:00.000Z" })
    expect(() => collectStorePickupMetadata({}, "2026-09-10T10:00:00.000Z")).toThrow("только для заказа с самовывозом")
  })

  // Store pickup rides on the manual provider, so without this the fallback
  // branch would hand a customer who never chose a delivery method an order
  // collected from the shop counter. Pickup has to be chosen, never defaulted.
  it("blocks checkout instead of silently defaulting to store pickup", () => {
    expect(() => resolveMissingProfileShippingOptions(["profile"], [
      { id: "manual", provider_id: "manual_manual", shipping_profile_id: "profile" },
      {
        id: "pickup",
        provider_id: "manual_manual",
        shipping_profile_id: "profile",
        data: { store_pickup: true },
      },
    ])).toThrow("Shipping method has not been selected")
  })

  // The mirror case: a profile whose only option is the plain manual one still
  // resolves, so adding pickup did not turn every unselected profile into a 409.
  it("still falls back to a plain manual option when no pickup option exists", () => {
    expect(resolveMissingProfileShippingOptions(["profile"], [
      { id: "manual", provider_id: "manual_manual", shipping_profile_id: "profile" },
    ])).toEqual([{ id: "manual" }])
  })
})
