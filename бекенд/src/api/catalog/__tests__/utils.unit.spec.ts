import {
  listNewCatalogProducts,
  listPromotedCatalogProducts,
  mapCatalogProduct,
  retrieveCatalogProduct,
  sortCatalogProducts,
  validateCatalogCart,
  validateCatalogCartItems,
} from "../utils"

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
    metadata: {
      brand: "Novol",
      characteristics: { Объем: "1 л" },
    },
    categories: [{ name: "Грунты" }],
    variants: [
      {
        id: "variant_1",
        title: "1 л",
        sku: "PRIMER-GREY-1L",
        manage_inventory: true,
        options: [{ value: "1 л", option: { title: "Фасовка" } }],
        price_set: {
          prices: [{ amount: 1200, currency_code: "rub" }],
        },
        inventory_items: inventoryItems(10),
      },
      {
        id: "variant_2",
        title: "3 л",
        sku: "PRIMER-GREY-3L",
        manage_inventory: true,
        allow_backorder: true,
        options: [{ value: "3 л", option: { title: "Фасовка" } }],
        price_set: {
          prices: [{ amount: 3000, currency_code: "rub" }],
        },
        inventory_items: inventoryItems(0),
      },
    ],
    ...overrides,
  }
}

describe("mapCatalogProduct", () => {
  it("exposes normalized video URLs only in product details", () => {
    const source = product({
      metadata: {
        video_urls: [
          " https://www.youtube.com/watch?v=video123 ",
          "",
          42,
          "https://vimeo.com/123456",
        ],
      },
    })

    expect(mapCatalogProduct(source)).not.toHaveProperty("video_urls")
    expect(mapCatalogProduct(source, { includeDetails: true })).toEqual(
      expect.objectContaining({
        video_urls: [
          "https://www.youtube.com/watch?v=video123",
          "https://vimeo.com/123456",
        ],
      }),
    )
  })

  it("exposes safe product documents only in product details", () => {
    const source = product({
      metadata: {
        documents: [
          {
            id: " file_1 ",
            name: " Паспорт безопасности.pdf ",
            url: " https://cdn.example.test/safety.pdf ",
          },
          {
            id: "file_2",
            name: "Unsafe",
            url: "javascript:alert(1)",
          },
          { name: "Missing storage id", url: "https://example.test/file.pdf" },
        ],
      },
    })

    expect(mapCatalogProduct(source)).not.toHaveProperty("documents")
    expect(mapCatalogProduct(source, { includeDetails: true })).toEqual(
      expect.objectContaining({
        documents: [
          {
            name: "Паспорт безопасности.pdf",
            url: "https://cdn.example.test/safety.pdf",
          },
        ],
      }),
    )
  })

  it("maps detail variants with per-variant price, SKU, options and availability", () => {
    expect(mapCatalogProduct(product(), { includeDetails: true })).toEqual(
      expect.objectContaining({
        id: "prod_1",
        title: "Акриловый грунт серый",
        variant_id: null,
        article: null,
        price: 1200,
        availability: "in_stock",
        category: "Грунты",
        brand: "Novol",
        characteristics: { Объем: "1 л" },
        variants: [
          expect.objectContaining({
            id: "variant_1",
            title: "1 л",
            article: "PRIMER-GREY-1L",
            price: 1200,
            availability: "in_stock",
            max_quantity: 10,
            options: { Фасовка: "1 л" },
          }),
          expect.objectContaining({
            id: "variant_2",
            title: "3 л",
            article: "PRIMER-GREY-3L",
            price: 3000,
            availability: "backorder",
            max_quantity: null,
            options: { Фасовка: "3 л" },
          }),
        ],
      })
    )
  })

  it("exposes a direct purchase variant for single-variant products", () => {
    expect(
      mapCatalogProduct(
        product({
          variants: [
            {
              id: "variant_single",
              title: "1 л",
              sku: "PRIMER-SINGLE-1L",
              manage_inventory: true,
              options: [{ value: "1 л", option: { title: "Фасовка" } }],
              price_set: {
                prices: [{ amount: 1100, currency_code: "rub" }],
              },
              inventory_items: inventoryItems(5),
            },
          ],
        })
      )
    ).toEqual(
      expect.objectContaining({
        variant_id: "variant_single",
        article: "PRIMER-SINGLE-1L",
        price: 1100,
        max_quantity: 5,
      })
    )
  })

  it("maps SKU-specific products to the matching variant and price", () => {
    expect(mapCatalogProduct(product(), { sku: "PRIMER-GREY-3L" })).toEqual(
      expect.objectContaining({
        variant_id: "variant_2",
        article: "PRIMER-GREY-3L",
        price: 3000,
        availability: "backorder",
        max_quantity: null,
      })
    )
  })

  it("maps variant-specific products without requiring SKU", () => {
    expect(
      mapCatalogProduct(
        product({
          variants: [
            {
              id: "variant_no_sku",
              title: "Без артикула",
              sku: null,
              manage_inventory: true,
              options: [{ value: "1 л", option: { title: "Фасовка" } }],
              price_set: {
                prices: [{ amount: 1500, currency_code: "rub" }],
              },
              inventory_items: inventoryItems(4),
            },
          ],
        }),
        { variantId: "variant_no_sku" }
      )
    ).toEqual(
      expect.objectContaining({
        variant_id: "variant_no_sku",
        article: null,
        price: 1500,
        availability: "in_stock",
        max_quantity: 4,
      })
    )
  })

  it("rejects a specific variant when that variant has no price", () => {
    expect(
      mapCatalogProduct(
        product({
          variants: [
            {
              id: "variant_without_price",
              title: "1 л",
              sku: "NO-PRICE",
              manage_inventory: true,
              options: [{ value: "1 л", option: { title: "Фасовка" } }],
              price_set: { prices: [] },
              inventory_items: inventoryItems(4),
            },
            {
              id: "variant_with_price",
              title: "3 л",
              sku: "WITH-PRICE",
              manage_inventory: true,
              options: [{ value: "3 л", option: { title: "Фасовка" } }],
              price_set: {
                prices: [{ amount: 2500, currency_code: "rub" }],
              },
              inventory_items: inventoryItems(4),
            },
          ],
        }),
        { variantId: "variant_without_price" }
      )
    ).toBeNull()
  })

  it("does not expose draft products on the public read path", () => {
    expect(
      mapCatalogProduct(product({ status: "draft" }), { includeDetails: true })
    ).toBeNull()
  })

  it("rejects malformed required product fields and normalizes optional metadata", () => {
    expect(mapCatalogProduct(product({ id: null }))).toBeNull()
    expect(mapCatalogProduct(product({ title: " " }))).toBeNull()
    expect(mapCatalogProduct(product({ categories: [] }))).toBeNull()
    expect(mapCatalogProduct(product({ variants: [] }))).toBeNull()

    expect(
      mapCatalogProduct(
        product({
          metadata: {
            brand: " ",
            characteristics: { "": "bad", Good: " value ", Bad: 1 },
            video_urls: "not-an-array",
            documents: "not-an-array",
          },
        }),
        { includeDetails: true }
      )
    ).toEqual(
      expect.objectContaining({
        brand: null,
        characteristics: { Good: " value " },
        video_urls: [],
        documents: [],
      })
    )
  })

  it("supports legacy price and option records and derives a variant title", () => {
    expect(
      mapCatalogProduct(
        product({
          variants: [
            {
              id: "variant-legacy",
              sku: "LEGACY",
              manage_inventory: false,
              options: { Color: " Red ", Empty: " " },
              prices: [
                { amount: "200", currency_code: "usd" },
                { amount: "100", currency_code: "usd" },
                { amount: "bad", currency_code: "rub" },
              ],
            },
          ],
        }),
        { includeDetails: true }
      )
    ).toEqual(
      expect.objectContaining({
        price: 100,
        variants: [
          expect.objectContaining({ title: "Red", options: { Color: "Red" } }),
        ],
      })
    )
  })
})

function queryContainer(products: unknown[], collectionId: string | null = "collection-1") {
  const graph = jest.fn().mockResolvedValue({ data: products })
  const listProductCollections = jest
    .fn()
    .mockResolvedValue(collectionId ? [{ id: collectionId }] : [])
  return {
    container: {
      resolve: jest.fn((key: string) =>
        key === "query" ? { graph } : { listProductCollections }
      ),
    } as any,
    graph,
    listProductCollections,
  }
}

describe("catalog listing and validation", () => {
  it("returns promoted, new and detailed products through their query contracts", async () => {
    const { container, graph } = queryContainer([product()])
    await expect(listPromotedCatalogProducts(container)).resolves.toHaveLength(1)
    await expect(listNewCatalogProducts(container)).resolves.toHaveLength(1)
    await expect(retrieveCatalogProduct(container, "prod_1")).resolves.toEqual(
      expect.objectContaining({ id: "prod_1", variants: expect.any(Array) })
    )
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ status: "published" }) })
    )
  })

  it("returns no promotions when the configured collection is absent", async () => {
    const { container, graph } = queryContainer([product()], null)
    await expect(listPromotedCatalogProducts(container)).resolves.toEqual([])
    expect(graph).not.toHaveBeenCalled()
  })

  it("orders promotions by recency, not alphabetically", async () => {
    const newest = product({ id: "prod_newest", title: "Акриловый грунт серый" })
    const oldest = product({ id: "prod_oldest", title: "Яхтный лак" })
    const { container, graph } = queryContainer([newest, oldest])

    const result = await listPromotedCatalogProducts(container)

    expect(result.map(({ id }) => id)).toEqual(["prod_newest", "prod_oldest"])
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        pagination: expect.objectContaining({ order: { created_at: "DESC" } }),
      })
    )
  })

  it("validates duplicate SKUs independently and distinguishes stock failures", async () => {
    const stocked = product()
    const { container } = queryContainer([stocked])
    const results = await validateCatalogCart(container, [
      "PRIMER-GREY-1L",
      "PRIMER-GREY-3L",
      "MISSING",
      "PRIMER-GREY-1L",
    ])

    expect(results).toEqual([
      expect.objectContaining({ sku: "PRIMER-GREY-1L", purchasable: true, problem: null }),
      expect.objectContaining({ sku: "PRIMER-GREY-3L", purchasable: true, problem: null }),
      expect.objectContaining({ sku: "MISSING", purchasable: false, problem: "not_found" }),
      expect.objectContaining({ sku: "PRIMER-GREY-1L", purchasable: true }),
    ])
  })

  it("validates requested quantities against exact variants", async () => {
    const noBackorder = product({
      variants: [
        {
          id: "limited",
          sku: "LIMITED",
          manage_inventory: true,
          allow_backorder: false,
          price_set: { prices: [{ amount: 100, currency_code: "rub" }] },
          inventory_items: inventoryItems(2),
        },
        {
          id: "unmanaged",
          sku: "UNMANAGED",
          manage_inventory: false,
          price_set: { prices: [{ amount: 200, currency_code: "rub" }] },
        },
      ],
    })
    const { container } = queryContainer([noBackorder])

    await expect(
      validateCatalogCartItems(container, [
        { variant_id: "limited", quantity: 3 },
        { variant_id: "unmanaged", quantity: 999 },
        { variant_id: "missing", quantity: 1 },
      ])
    ).resolves.toEqual([
      expect.objectContaining({ problem: "insufficient_stock", available_quantity: 2, purchasable: false }),
      expect.objectContaining({ problem: null, available_quantity: null, purchasable: true }),
      expect.objectContaining({ problem: "not_found", product: null, purchasable: false }),
    ])
  })
})
