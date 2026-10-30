const mockValidateCatalogCartItems = jest.fn()

jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: string, invoke: any, compensate?: any) =>
    Object.assign(invoke, { compensate }),
  createWorkflow: (_name: unknown, builder: unknown) => ({ builder }),
  StepResponse: class StepResponse<T, C> {
    constructor(readonly result: T, readonly compensation?: C) {}
  },
  WorkflowResponse: class WorkflowResponse<T> {
    constructor(readonly result: T) {}
  },
  transform: (data: any, mapper: (data: any) => any) => mapper(data),
}))

jest.mock("../../../api/catalog/utils", () => ({
  validateCatalogCartItems: (...args: unknown[]) => mockValidateCatalogCartItems(...args),
}))

jest.mock("../../sync-catalog-shipping-address", () => ({
  buildCatalogShippingAddressFields: (input: any) => ({
    city: input.city,
    address_1: input.street && input.house
      ? `${input.street}, ${input.house}`
      : "Пункт выдачи",
    address_2: input.apartment ? `кв. ${input.apartment}` : undefined,
  }),
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  CatalogCheckoutCartValidationError,
  CatalogCheckoutShippingProviderHiddenError,
  checkCatalogCheckoutShippingProviderVisibilityStep,
  getCatalogCheckoutCartValidation,
  isCatalogCheckoutCartValidationError,
  isCatalogCheckoutShippingProviderHiddenError,
  prepareCatalogCheckoutCartUpdateStep,
  prepareCatalogCheckoutShippingOptionsStep,
  retrieveCatalogCartPaymentCollectionStep,
  validateCatalogCheckoutCartStep,
} from "../catalog-checkout"
import { SHIPPING_PROVIDER_REGISTRY_MODULE } from "../../../modules/shipping-provider-registry"

function queryContainer(responses: unknown[], service?: unknown) {
  const query = {
    graph: jest.fn(async () => ({ data: responses.shift() ?? [] })),
  }
  const container = {
    resolve: jest.fn((key) => {
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === SHIPPING_PROVIDER_REGISTRY_MODULE) return service
      throw new Error(`Unexpected dependency: ${String(key)}`)
    }),
  }
  return { container: container as any, query }
}

const checkoutInput = {
  cart_id: "cart_1",
  name: "Иван",
  phone: "+79990000000",
  email: " Buyer@Example.Test ",
  city: "Москва",
  street: "Ленина",
  house: "10",
  apartment: "5",
  comment: " Позвонить ",
}

beforeEach(() => jest.clearAllMocks())

describe("checkout cart validation step", () => {
  it("normalizes quantities before validating inventory", async () => {
    const { container } = queryContainer([[
      { id: "cart_1", items: [
        { variant_id: "variant_1", quantity: "2.9" },
        { variant_id: "variant_2", quantity: 0 },
        { variant_id: "variant_3", quantity: "bad" },
      ] },
    ]])
    mockValidateCatalogCartItems.mockResolvedValue([
      { variant_id: "variant_1", purchasable: true },
    ])

    await expect(getCatalogCheckoutCartValidation(container, "cart_1"))
      .resolves.toEqual([{ variant_id: "variant_1", purchasable: true }])
    expect(mockValidateCatalogCartItems).toHaveBeenCalledWith(container, [
      { variant_id: "variant_1", quantity: 2 },
      { variant_id: "variant_2", quantity: 1 },
      { variant_id: "variant_3", quantity: 1 },
    ])
  })

  it("rejects empty carts and lines without a variant", async () => {
    for (const cart of [undefined, { id: "cart_1", items: [] }, { id: "cart_1", items: null }]) {
      const { container } = queryContainer([[cart].filter(Boolean)])
      await expect(getCatalogCheckoutCartValidation(container, "cart_1"))
        .rejects.toThrow("Cart is empty")
    }
    const { container } = queryContainer([[
      { id: "cart_1", items: [{ variant_id: null, quantity: 1 }] },
    ]])
    await expect(getCatalogCheckoutCartValidation(container, "cart_1"))
      .rejects.toThrow("missing variant")
  })

  it("throws a typed error when any item became unavailable", async () => {
    const items = [
      { variant_id: "variant_1", purchasable: true },
      { variant_id: "variant_2", purchasable: false },
    ]
    const { container } = queryContainer([[
      { id: "cart_1", items: [{ variant_id: "variant_1", quantity: 1 }] },
    ]])
    mockValidateCatalogCartItems.mockResolvedValue(items)

    await expect((validateCatalogCheckoutCartStep as any)(
      { cart_id: "cart_1" },
      { container },
    )).rejects.toEqual(expect.objectContaining({ items }))
    expect(isCatalogCheckoutCartValidationError(new CatalogCheckoutCartValidationError(items as any)))
      .toBe(true)
    expect(isCatalogCheckoutCartValidationError(new Error("other"))).toBe(false)
  })

  it("returns validated purchasable items", async () => {
    const items = [{ variant_id: "variant_1", purchasable: true }]
    const { container } = queryContainer([[
      { id: "cart_1", items: [{ variant_id: "variant_1", quantity: 1 }] },
    ]])
    mockValidateCatalogCartItems.mockResolvedValue(items)
    const response = await (validateCatalogCheckoutCartStep as any)(
      { cart_id: "cart_1" },
      { container },
    )
    expect(response.result).toEqual({ items })
  })
})

describe("checkout cart update step", () => {
  it("uses the cart country, normalizes identity fields and preserves metadata", async () => {
    const { container } = queryContainer([[
      {
        id: "cart_1",
        metadata: { keep: true },
        shipping_address: { country_code: "ru" },
        region: { countries: [{ iso_2: "kz" }] },
      },
    ]])
    const response = await (prepareCatalogCheckoutCartUpdateStep as any)(
      { ...checkoutInput, customer_id: undefined },
      { container },
    )
    expect(response.result).toEqual(expect.objectContaining({
      id: "cart_1",
      email: "buyer@example.test",
      customer_id: null,
      shipping_address: expect.objectContaining({
        country_code: "ru",
        city: "Москва",
        address_1: "Ленина, 10",
        // Квартира кладётся как есть: единственный источник —
        // buildCatalogShippingAddressFields (`address_2: input.apartment`),
        // префикса «кв.» там нет.
        address_2: "5",
        metadata: { street: "Ленина", house: "10", apartment: "5" },
      }),
      billing_address: expect.objectContaining({ country_code: "ru" }),
      metadata: expect.objectContaining({ keep: true, checkout_comment: "Позвонить" }),
    }))
  })

  it("falls back to the first valid region country and supports pickup-only addresses", async () => {
    const { container } = queryContainer([[
      {
        id: "cart_1",
        shipping_address: null,
        region: { countries: [{ iso_2: null }, { iso_2: "ru" }] },
      },
    ]])
    const response = await (prepareCatalogCheckoutCartUpdateStep as any)(
      { ...checkoutInput, street: undefined, house: undefined, apartment: undefined },
      { container },
    )
    expect(response.result.shipping_address).toEqual(expect.objectContaining({
      country_code: "ru",
      city: "Москва",
      // У корзины нет выбранного ПВЗ, поэтому улицы и дома нет и address_1
      // остаётся пустым — ровно ради этого шаг и не склеивает его из
      // street/house, иначе вышло бы «undefined, undefined». Реальный адрес
      // пункта выдачи подставляется, когда ПВЗ выбран (issue #40).
      address_1: undefined,
      address_2: undefined,
      metadata: {},
    }))
  })

  it("rejects a cart without a configured country", async () => {
    for (const cart of [undefined, { id: "cart_1", region: { countries: [] } }]) {
      const { container } = queryContainer([[cart].filter(Boolean)])
      await expect((prepareCatalogCheckoutCartUpdateStep as any)(checkoutInput, { container }))
        .rejects.toThrow("does not include a country")
    }
  })
})

describe("checkout shipping/payment preparation steps", () => {
  it("adds no option when every required shipping profile is already covered", async () => {
    const { container, query } = queryContainer([[
      {
        id: "cart_1",
        items: [
          { requires_shipping: true, variant: { product: { shipping_profile: { id: "profile_1" } } } },
          { requires_shipping: false, variant: { product: { shipping_profile: { id: "profile_2" } } } },
          { requires_shipping: true, variant: null },
        ],
        shipping_methods: [{ shipping_option: { shipping_profile_id: "profile_1" } }],
      },
    ]])
    const response = await (prepareCatalogCheckoutShippingOptionsStep as any)(
      { cart_id: "cart_1" },
      { container },
    )
    expect(response.result).toEqual({ options: [] })
    expect(query.graph).toHaveBeenCalledTimes(1)
  })

  it("selects one fallback option for each uncovered profile", async () => {
    const { container } = queryContainer([
      [{
        id: "cart_1",
        items: [
          { requires_shipping: true, variant: { product: { shipping_profile: { id: "profile_1" } } } },
          { requires_shipping: true, variant: { product: { shipping_profile: { id: "profile_1" } } } },
          { requires_shipping: true, variant: { product: { shipping_profile: { id: "profile_2" } } } },
        ],
        shipping_methods: [{ shipping_option: null }],
      }],
      [
        { id: "manual_1", provider_id: "manual_manual", shipping_profile_id: "profile_1" },
        { id: "manual_2", provider_id: "manual_manual", shipping_profile_id: "profile_2" },
      ],
    ])
    const response = await (prepareCatalogCheckoutShippingOptionsStep as any)(
      { cart_id: "cart_1" },
      { container },
    )
    expect(response.result).toEqual({ options: [{ id: "manual_1" }, { id: "manual_2" }] })
  })

  it("retrieves an existing payment collection or returns null", async () => {
    const withCollection = queryContainer([[
      { id: "cart_1", payment_collection: { id: "paycol_1" } },
    ]])
    const existing = await (retrieveCatalogCartPaymentCollectionStep as any)(
      { cart_id: "cart_1" },
      { container: withCollection.container },
    )
    expect(existing.result).toEqual({ id: "paycol_1" })

    const withoutCollection = queryContainer([[{ id: "cart_1", payment_collection: null }]])
    const missing = await (retrieveCatalogCartPaymentCollectionStep as any)(
      { cart_id: "cart_1" },
      { container: withoutCollection.container },
    )
    expect(missing.result).toEqual({ id: null })
  })
})

describe("shipping-provider visibility recheck", () => {
  it("does not consult the registry for a manual checkout", async () => {
    const service = { listShippingProviderVisibilities: jest.fn() }
    const { container } = queryContainer([[
      { shipping_methods: [{ shipping_option: { provider_id: "manual_manual" } }] },
    ]], service)
    const response = await (checkCatalogCheckoutShippingProviderVisibilityStep as any)(
      { cart_id: "cart_1" },
      { container },
    )
    expect(response.result).toEqual({ checked: true })
    expect(service.listShippingProviderVisibilities).not.toHaveBeenCalled()
  })

  it("rechecks a visible direct provider", async () => {
    const service = {
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([{ is_visible: true }]),
    }
    const visible = queryContainer([[
      { shipping_methods: [{ shipping_option: { provider_id: "ozon_ozon" } }] },
    ]], service)
    await expect((checkCatalogCheckoutShippingProviderVisibilityStep as any)(
      { cart_id: "cart_1" },
      { container: visible.container },
    )).resolves.toEqual(expect.objectContaining({ result: { checked: true } }))
    expect(service.listShippingProviderVisibilities).toHaveBeenCalledWith({ provider_key: "ozon_ozon" })
  })
})
