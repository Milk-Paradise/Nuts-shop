import {
  CheckoutCatalogOrderSchema,
  GetCatalogSearchSchema,
  GetCategoryProductsSchema,
  GetPickupPointsSchema,
  GetShippingOptionsSchema,
  GetShippingTariffsSchema,
  InitiateCatalogPaymentSchema,
  ValidateCatalogCartSchema,
} from "../validators"

const basePayload = {
  cart_id: "cart_1",
  name: "Иван Иванов",
  phone: "+7 999 000-00-00",
  email: "ivan@example.com",
  city: "Москва",
}

describe("CheckoutCatalogOrderSchema", () => {
  it("accepts a pickup (ПВЗ) checkout with only city and no street/house/apartment", () => {
    const result = CheckoutCatalogOrderSchema.safeParse(basePayload)

    expect(result.success).toBe(true)
  })

  it("accepts a courier checkout with the full address", () => {
    const result = CheckoutCatalogOrderSchema.safeParse({
      ...basePayload,
      street: "Ленина",
      house: "10",
      apartment: "5",
    })

    expect(result.success).toBe(true)
  })

  it("still rejects an empty string for street/house/apartment when present", () => {
    const result = CheckoutCatalogOrderSchema.safeParse({
      ...basePayload,
      street: "",
      house: "10",
      apartment: "5",
    })

    expect(result.success).toBe(false)
  })

  it("still requires city", () => {
    const result = CheckoutCatalogOrderSchema.safeParse({ ...basePayload, city: "" })

    expect(result.success).toBe(false)
  })
})

describe("InitiateCatalogPaymentSchema", () => {
  it("requires only order identity, provider, and return URL", () => {
    expect(InitiateCatalogPaymentSchema.parse({
      order_id: " order_1 ",
      provider_id: " yookassa ",
      return_url: "https://shop.test/payment/result",
    })).toEqual({
      order_id: "order_1",
      provider_id: "yookassa",
      return_url: "https://shop.test/payment/result",
    })
  })

  it("does not accept the old cart and checkout-contact payload", () => {
    expect(InitiateCatalogPaymentSchema.safeParse({
      ...basePayload,
      provider_id: "yookassa",
      return_url: "https://shop.test/payment/result",
    }).success).toBe(false)
  })
})

describe("catalog query preprocessing", () => {
  it("takes the first repeated query value and trims optional strings", () => {
    expect(GetCatalogSearchSchema.parse({
      q: [" paint ", "ignored"], category: 42, category_id: " ", brand: " Novol ",
    })).toMatchObject({ q: "paint", category: undefined, category_id: undefined, brand: "Novol" })
    expect(GetCategoryProductsSchema.parse({ subcategory: [" primer "] })).toEqual({
      subcategory: "primer",
    })
  })

  it("accepts non-negative prices and discards absent, negative, infinite, and malformed prices", () => {
    expect(GetCatalogSearchSchema.parse({ min_price: 0, max_price: "12.5" }))
      .toMatchObject({ min_price: 0, max_price: 12.5 })
    for (const value of [undefined, null, "", -1, "bad", Infinity]) {
      expect(GetCatalogSearchSchema.parse({ min_price: value }).min_price).toBeUndefined()
    }
  })

  it("floors positive page values and discards missing or non-positive integers", () => {
    expect(GetCatalogSearchSchema.parse({ page: ["2.9"], limit: 10 })).toMatchObject({ page: 2, limit: 10 })
    for (const value of [undefined, null, "", 0, -1, "bad", Infinity]) {
      expect(GetCatalogSearchSchema.parse({ page: value }).page).toBeUndefined()
    }
  })

  it("keeps supported availability/sort and falls back for unknown or non-string values", () => {
    expect(GetCatalogSearchSchema.parse({ availability: ["in_stock"], sort: ["price_desc"] }))
      .toMatchObject({ availability: "in_stock", sort: "price_desc" })
    expect(GetCatalogSearchSchema.parse({ availability: "future", sort: "future" }))
      .toMatchObject({ availability: undefined, sort: "relevance" })
    expect(GetCatalogSearchSchema.parse({ availability: 42, sort: 42 }))
      .toMatchObject({ availability: undefined, sort: "relevance" })
  })

  it("normalizes array query values for shipping options, tariffs, and pickup points", () => {
    expect(GetShippingOptionsSchema.parse({ cart_id: [" cart_1 ", "ignored"] }))
      .toEqual({ cart_id: "cart_1" })
    expect(GetShippingTariffsSchema.parse({ city: [" Москва "], postal_code: [" 101000 "] }))
      .toEqual({ city: "Москва", postal_code: "101000" })
    expect(GetPickupPointsSchema.parse({ city: [" Москва "], provider_key: [" cdek "], address: 42 }))
      .toEqual({ city: "Москва", provider_key: "cdek", address: undefined })
  })

  it("requires a city for public shipping tariffs", () => {
    const result = GetShippingTariffsSchema.safeParse({ postal_code: "101000" })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["city"])
    }
  })
})

describe("cart validation preprocessing", () => {
  it("accepts either SKU or item contracts and repairs invalid item quantities", () => {
    expect(ValidateCatalogCartSchema.parse({ skus: [" SKU-1 "] })).toEqual({ skus: ["SKU-1"] })
    expect(ValidateCatalogCartSchema.parse({ items: [{ variant_id: " v1 ", quantity: 0 }] }))
      .toEqual({ items: [{ variant_id: "v1", quantity: 1 }] })
  })

  it("requires at least one supported cart identity", () => {
    expect(ValidateCatalogCartSchema.safeParse({}).success).toBe(false)
    expect(ValidateCatalogCartSchema.safeParse({ skus: [] }).success).toBe(false)
    expect(ValidateCatalogCartSchema.safeParse({ items: [] }).success).toBe(false)
  })
})
