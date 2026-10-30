import {
  buildCheckoutAddressMetadata,
  buildCheckoutOrderMetadata,
  cartPickupPoint,
  isCatalogCheckoutCartValidationError,
  isCatalogCheckoutShippingNotSelectedError,
  isCatalogCheckoutShippingProviderHiddenError,
  resolveCatalogPaymentCollectionId,
  resolveMissingProfileShippingOptions,
} from "../catalog-checkout"

describe("resolveCatalogPaymentCollectionId", () => {
  it("keeps using an existing payment collection", () => {
    expect(
      resolveCatalogPaymentCollectionId({
        existing_payment_collection: { id: "pay_col_existing" },
        created_payment_collection: null,
      })
    ).toBe("pay_col_existing")
  })

  it("uses the collection created by the conditional checkout branch", () => {
    expect(
      resolveCatalogPaymentCollectionId({
        existing_payment_collection: { id: null },
        created_payment_collection: { id: "pay_col_created" },
      })
    ).toBe("pay_col_created")
  })

  it("throws the existing error at runtime when neither branch provides a collection", () => {
    expect(() =>
      resolveCatalogPaymentCollectionId({
        existing_payment_collection: { id: null },
        created_payment_collection: null,
      })
    ).toThrow("Payment collection was not created")
  })
})

describe("resolveMissingProfileShippingOptions", () => {
  it("falls back to the manual option when the profile has no selected option", () => {
    const result = resolveMissingProfileShippingOptions(
      ["profile-1"],
      [
        { id: "so-manual", provider_id: "manual_manual", shipping_profile_id: "profile-1" },
        { id: "so-other", provider_id: "some_other_provider", shipping_profile_id: "profile-1" },
      ]
    )

    expect(result).toEqual([{ id: "so-manual" }])
  })

  it("falls back to the first available option when no manual option exists either", () => {
    const result = resolveMissingProfileShippingOptions(
      ["profile-1"],
      [{ id: "so-other", provider_id: "some_other_provider", shipping_profile_id: "profile-1" }]
    )

    expect(result).toEqual([{ id: "so-other" }])
  })

  it("throws a MedusaError when a profile has no shipping options at all", () => {
    expect(() => resolveMissingProfileShippingOptions(["profile-1"], [])).toThrow(
      "No shipping option is available for cart items"
    )
  })

  it("resolves independently per missing profile", () => {
    const result = resolveMissingProfileShippingOptions(
      ["profile-1", "profile-2"],
      [
        { id: "so-manual-1", provider_id: "manual_manual", shipping_profile_id: "profile-1" },
        { id: "so-manual-2", provider_id: "manual_manual", shipping_profile_id: "profile-2" },
      ]
    )

    expect(result).toEqual([{ id: "so-manual-1" }, { id: "so-manual-2" }])
  })
})

describe("catalog checkout workflow error guards", () => {
  it("recognizes the plain error records emitted by the workflow engine", () => {
    expect(
      isCatalogCheckoutCartValidationError({
        name: "CatalogCheckoutCartValidationError",
        items: [],
      })
    ).toBe(true)
    expect(
      isCatalogCheckoutShippingNotSelectedError({
        name: "CatalogCheckoutShippingNotSelectedError",
      })
    ).toBe(true)
    expect(
      isCatalogCheckoutShippingProviderHiddenError({
        name: "CatalogCheckoutShippingProviderHiddenError",
      })
    ).toBe(true)
  })
})

describe("buildCheckoutAddressMetadata", () => {
  it("omits street/house/apartment entirely for a pickup (ПВЗ) checkout", () => {
    expect(buildCheckoutAddressMetadata({ name: "Иван", phone: "+79990000000" })).toEqual({})
  })

  it("includes only the fields that are actually present", () => {
    expect(
      buildCheckoutAddressMetadata({
        name: "Иван",
        phone: "+79990000000",
        street: "Ленина",
      })
    ).toEqual({ street: "Ленина" })
  })

  it("includes all courier fields when present", () => {
    expect(
      buildCheckoutAddressMetadata({
        name: "Иван",
        phone: "+79990000000",
        street: "Ленина",
        house: "10",
        apartment: "5",
      })
    ).toEqual({ street: "Ленина", house: "10", apartment: "5" })
  })
})

describe("buildCheckoutOrderMetadata", () => {
  it("carries only city for a pickup (ПВЗ) checkout, no stray street/house/apartment keys", () => {
    const result = buildCheckoutOrderMetadata({
      name: "Иван",
      phone: "+79990000000",
      city: "Москва",
      comment: "",
    })

    expect(result).toEqual({
      checkout_comment: "",
      checkout_contact_name: "Иван",
      checkout_contact_phone: "+79990000000",
      checkout_address_city: "Москва",
    })
  })

  it("carries the full address for a courier checkout", () => {
    const result = buildCheckoutOrderMetadata({
      name: "Иван",
      phone: "+79990000000",
      city: "Москва",
      street: "Ленина",
      house: "10",
      apartment: "5",
      comment: " Позвонить заранее ",
    })

    expect(result).toEqual({
      checkout_comment: "Позвонить заранее",
      checkout_contact_name: "Иван",
      checkout_contact_phone: "+79990000000",
      checkout_address_city: "Москва",
      checkout_address_street: "Ленина",
      checkout_address_house: "10",
      checkout_address_apartment: "5",
    })
  })

  it("merges on top of the cart's existing metadata without dropping unrelated keys", () => {
    const result = buildCheckoutOrderMetadata(
      { name: "Иван", phone: "+79990000000", city: "Москва", comment: "" },
      { some_other_key: "keep me" }
    )

    expect(result).toEqual(
      expect.objectContaining({ some_other_key: "keep me", checkout_address_city: "Москва" })
    )
  })

  it("preserves a historical pickup snapshot that lacks explicit identities", () => {
    const result = buildCheckoutOrderMetadata(
      { name: "Иван", phone: "+79990000000", city: "Москва", comment: "" },
      {
        checkout_pickup_point_id: "cdek:9001",
        checkout_pickup_point_name: "ПВЗ",
        checkout_pickup_point_address: "Москва, E2E улица, 7",
      }
    )

    expect(result).toEqual(expect.objectContaining({
      checkout_pickup_point_id: "cdek:9001",
      checkout_pickup_point_name: "ПВЗ",
      checkout_pickup_point_address: "Москва, E2E улица, 7",
    }))
    expect(result).not.toHaveProperty("checkout_pickup_point_provider_key")
    expect(result).not.toHaveProperty("checkout_pickup_point_external_id")
  })
})

describe("cartPickupPoint", () => {
  it("returns null when no shipping method carries a pickup point", () => {
    expect(cartPickupPoint(undefined)).toBeNull()
    expect(cartPickupPoint({ shipping_methods: [] })).toBeNull()
    expect(
      cartPickupPoint({ shipping_methods: [{ data: { unrelated_data: { tariff: {} } } }] })
    ).toBeNull()
  })

  it("reads the point the same way for both providers", () => {
    const point = {
      id: "cdek_cdek:9001", provider_key: "cdek_cdek", external_id: "9001",
      name: "ПВЗ", address: "Москва, E2E улица, 7",
    }

    expect(cartPickupPoint({ shipping_methods: [{ data: { pickup_point: point } }] })).toEqual(point)
  })

  it("ignores a point without an address: it could not answer where the order goes", () => {
    expect(
      cartPickupPoint({ shipping_methods: [{ data: { pickup_point: { id: "cdek:9001" } } }] })
    ).toBeNull()
  })

  it("keeps historical snapshots that predate explicit pickup identities readable", () => {
    expect(cartPickupPoint({ shipping_methods: [{ data: {
      pickup_point: { id: "cdek:9001", name: "ПВЗ", address: "Москва, E2E улица, 7" },
    } }] })).toEqual({ id: "cdek:9001", name: "ПВЗ", address: "Москва, E2E улица, 7" })
  })
})

describe("buildCheckoutOrderMetadata with a pickup point", () => {
  it("records where and by which carrier the order is delivered", () => {
    const result = buildCheckoutOrderMetadata(
      { name: "Иван", phone: "+79990000000", city: "Москва", comment: "" },
      {},
      {
        id: "cdek_cdek:9001", provider_key: "cdek_cdek", external_id: "9001",
        name: "ПВЗ Чистые пруды", address: "Москва, E2E улица, 7",
      }
    )

    expect(result.checkout_pickup_point_id).toBe("cdek_cdek:9001")
    expect(result.checkout_pickup_point_provider_key).toBe("cdek_cdek")
    expect(result.checkout_pickup_point_external_id).toBe("9001")
    expect(result.checkout_pickup_point_name).toBe("ПВЗ Чистые пруды")
    expect(result.checkout_pickup_point_address).toBe("Москва, E2E улица, 7")
  })
})
