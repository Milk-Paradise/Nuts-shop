import {
  buildCatalogIndexDocument,
  createCategoryPathResolver,
} from "../documents"

function inventoryItems(stocked: number, reserved = 0) {
  return [
    {
      required_quantity: 1,
      inventory: {
        location_levels: [
          { stocked_quantity: stocked, reserved_quantity: reserved },
        ],
      },
    },
  ]
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod_1",
    title: "Акриловый грунт серый",
    description: "Профессиональный грунт.",
    status: "published",
    thumbnail: "https://example.test/primer.jpg",
    metadata: { brand: "Novol" },
    categories: [{ id: "cat_child", name: "Грунты акриловые" }],
    variants: [
      {
        id: "variant_1",
        sku: "PRIMER-GREY-1L",
        manage_inventory: true,
        allow_backorder: false,
        price_set: {
          prices: [{ amount: 1200, currency_code: "rub" }],
        },
        inventory_items: inventoryItems(10),
      },
    ],
    ...overrides,
  }
}

const resolver = createCategoryPathResolver([
  { id: "cat_root", name: "Грунты", parent_category_id: null },
  { id: "cat_child", name: "Грунты акриловые", parent_category_id: "cat_root" },
])

describe("buildCatalogIndexDocument", () => {
  it("builds a full document for a valid published product", () => {
    expect(buildCatalogIndexDocument(product(), resolver)).toEqual({
      id: "prod_1",
      title: "Акриловый грунт серый",
      description: "Профессиональный грунт.",
      variant_id: "variant_1",
      article: "PRIMER-GREY-1L",
      articles: ["PRIMER-GREY-1L"],
      category: "Грунты акриловые",
      categories: ["Грунты", "Грунты акриловые"],
      category_ids: ["cat_root", "cat_child"],
      brand: "Novol",
      price: 1200,
      availability: "in_stock",
      max_quantity: 10,
      availability_rank: 0,
      image_url: "https://example.test/primer.jpg",
      search_keywords: [],
    })
  })

  it("normalizes unique search keywords from product metadata", () => {
    const document = buildCatalogIndexDocument(
      product({
        metadata: {
          brand: "Novol",
          search_keywords: [" аэрозоль ", "RAL 7004", "аэрозоль", 42, ""],
        },
      }),
      resolver,
    )

    expect(document?.search_keywords).toEqual(["аэрозоль", "RAL 7004"])
  })

  it("returns null for a draft product", () => {
    expect(
      buildCatalogIndexDocument(product({ status: "draft" }), resolver)
    ).toBeNull()
  })

  it("returns null when the product has no title", () => {
    expect(
      buildCatalogIndexDocument(product({ title: "  " }), resolver)
    ).toBeNull()
  })

  it("returns null when the product has no category", () => {
    expect(
      buildCatalogIndexDocument(product({ categories: [] }), resolver)
    ).toBeNull()
  })

  it("returns null when the product has no positive RUB price", () => {
    const withoutPrice = product({
      variants: [
        {
          id: "variant_1",
          sku: "PRIMER-GREY-1L",
          manage_inventory: true,
          price_set: { prices: [] },
          inventory_items: inventoryItems(10),
        },
      ],
    })

    expect(buildCatalogIndexDocument(withoutPrice, resolver)).toBeNull()
  })

  it("collects unique variant SKUs and the minimum price", () => {
    const multiVariant = product({
      variants: [
        {
          id: "variant_1",
          sku: "PRIMER-GREY-1L",
          manage_inventory: true,
          price_set: { prices: [{ amount: 1200, currency_code: "rub" }] },
          inventory_items: inventoryItems(10),
        },
        {
          id: "variant_2",
          sku: "PRIMER-GREY-3L",
          manage_inventory: true,
          price_set: { prices: [{ amount: 900, currency_code: "rub" }] },
          inventory_items: inventoryItems(0),
        },
        {
          id: "variant_3",
          sku: "  ",
          manage_inventory: true,
          price_set: { prices: [{ amount: 1500, currency_code: "rub" }] },
          inventory_items: inventoryItems(0),
        },
      ],
    })

    const document = buildCatalogIndexDocument(multiVariant, resolver)

    expect(document?.articles).toEqual(["PRIMER-GREY-1L", "PRIMER-GREY-3L"])
    expect(document?.variant_id).toBeNull()
    expect(document?.price).toBe(900)
  })

  it("omits category identity when the category path cannot be resolved", () => {
    const unknownCategory = product({
      categories: [{ id: "cat_unknown", name: "Прочее" }],
    })

    expect(buildCatalogIndexDocument(unknownCategory, resolver)).toMatchObject({
      category: "",
      categories: [],
      category_ids: [],
    })
  })

  it("computes availability from inventory", () => {
    const backorder = product({
      variants: [
        {
          id: "variant_1",
          sku: "PRIMER-GREY-1L",
          manage_inventory: true,
          allow_backorder: true,
          price_set: { prices: [{ amount: 1200, currency_code: "rub" }] },
          inventory_items: inventoryItems(0),
        },
      ],
    })

    const document = buildCatalogIndexDocument(backorder, resolver)

    expect(document?.availability).toBe("backorder")
    expect(document?.max_quantity).toBeNull()
    expect(document?.availability_rank).toBe(1)
  })
})

describe("createCategoryPathResolver", () => {
  it("builds the path from root to leaf", () => {
    expect(resolver("cat_child")).toEqual(["Грунты", "Грунты акриловые"])
    expect(resolver("cat_root")).toEqual(["Грунты"])
  })

  it("returns an empty path for unknown categories", () => {
    expect(resolver("cat_unknown")).toEqual([])
  })

  it("does not expose cyclic category paths", () => {
    const cyclic = createCategoryPathResolver([
      { id: "a", name: "A", parent_category_id: "b" },
      { id: "b", name: "B", parent_category_id: "a" },
    ])

    expect(cyclic("a")).toEqual([])
    expect(cyclic.idsFor("a")).toEqual([])
  })

  it("does not expose a public child below a private ancestor", () => {
    const resolve = createCategoryPathResolver([
      {
        id: "hidden",
        name: "Скрытая категория",
        is_active: false,
      },
      {
        id: "child",
        name: "Дочерняя категория",
        parent_category_id: "hidden",
      },
    ])

    expect(resolve("child")).toEqual([])
    expect(resolve.idsFor("child")).toEqual([])
  })

  it("ignores categories without identifiers and blank names in a path", () => {
    const resolve = createCategoryPathResolver([
      { id: null, name: "Ignored" },
      { id: "root", name: "  " },
      { id: "child", name: "Child", parent_category_id: "root" },
    ])
    expect(resolve("child")).toEqual(["Child"])
  })
})

describe("document optional-field boundaries", () => {
  it("deduplicates SKUs and categories while tolerating missing arrays and metadata", () => {
    const value = product({
      description: undefined,
      thumbnail: undefined,
      metadata: null,
      categories: [
        { id: "cat_child", name: "ignored" },
        { id: "cat_child", name: "ignored" },
        { id: null, name: " Direct " },
        { id: null, name: " " },
      ],
      variants: [
        { id: "v1", sku: " SKU ", manage_inventory: false, price_set: { prices: [{ amount: 100, currency_code: "rub" }] } },
        { id: "v2", sku: "SKU", manage_inventory: false, price_set: { prices: [{ amount: 200, currency_code: "rub" }] } },
      ],
    })
    expect(buildCatalogIndexDocument(value, resolver)).toMatchObject({
      description: null,
      image_url: null,
      brand: null,
      articles: ["SKU"],
      categories: ["Грунты", "Грунты акриловые", "Direct"],
      search_keywords: [],
    })
  })

  it("handles a product with omitted variants without throwing", () => {
    expect(buildCatalogIndexDocument(product({ variants: undefined }), resolver)).toBeNull()
  })
})
