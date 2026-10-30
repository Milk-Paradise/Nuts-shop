import {
  buildCatalogImportPlan,
  fetchMoyskladCatalog,
  planCatalogCategories,
  readMoyskladEnvironment,
  selectSalePrice,
  type ExistingSkuMatch,
  type MoyskladCatalogProduct,
} from "../import-moysklad-catalog"

function product(
  overrides: Partial<MoyskladCatalogProduct> = {}
): MoyskladCatalogProduct {
  return {
    id: overrides.id ?? "ms-1",
    name: overrides.name ?? "Грунт",
    code: overrides.code ?? "SKU-1",
    salePrices: overrides.salePrices ?? [
      { value: 191520, priceType: { name: "Цена продажи" } },
    ],
    images: overrides.images ?? {
      meta: { href: "https://api.moysklad.ru/images", size: 0 },
    },
    ...overrides,
  }
}

describe("MoySklad catalog import", () => {
  it("selects only the public sale price and converts kopecks to Medusa rubles", () => {
    const result = selectSalePrice(
      product({
        salePrices: [
          { value: 100, priceType: { name: "Маляр Валера" } },
          { value: 191520, priceType: { name: "Цена продажи" } },
          { value: 200, priceType: { name: "Дмитрий Одинцово" } },
        ],
      })
    )

    expect(result).toEqual({ rawKopecks: 191520, amountRubles: 1915.2 })
  })

  it("distinguishes a missing public price from a zero public price", () => {
    expect(
      selectSalePrice(
        product({ salePrices: [{ value: 5000, priceType: { name: "Маляры" } }] })
      )
    ).toEqual({ reason: "missing_sale_price" })
    expect(
      selectSalePrice(
        product({ salePrices: [{ value: 0, priceType: { name: "Цена продажи" } }] })
      )
    ).toEqual({ reason: "zero_sale_price" })
  })

  it("plans creates and updates by variant SKU and reports every skip reason", () => {
    const products = [
      product({ id: "create", code: "CREATE" }),
      product({ id: "update", code: "UPDATE" }),
      product({ id: "archived", code: "ARCHIVED", archived: true }),
      product({ id: "no-code", code: "" }),
      product({ id: "no-price", code: "NO-PRICE", salePrices: [] }),
      product({
        id: "zero-price",
        code: "ZERO-PRICE",
        salePrices: [{ value: 0, priceType: { name: "Цена продажи" } }],
      }),
      product({ id: "duplicate-1", code: "DUPLICATE" }),
      product({ id: "duplicate-2", code: "DUPLICATE" }),
      product({ id: "ambiguous", code: "AMBIGUOUS" }),
    ]
    const matches = new Map<string, ExistingSkuMatch[]>([
      ["UPDATE", [{ variantId: "variant-1", productId: "product-1", sku: "UPDATE" }]],
      [
        "AMBIGUOUS",
        [
          { variantId: "variant-2", productId: "product-2", sku: "AMBIGUOUS" },
          { variantId: "variant-3", productId: "product-3", sku: "AMBIGUOUS" },
        ],
      ],
    ])

    const plan = buildCatalogImportPlan(products, matches)

    expect(plan.items.map(({ action, sku }) => [action, sku])).toEqual([
      ["create", "CREATE"],
      ["update", "UPDATE"],
    ])
    expect(plan.skipped).toEqual({
      archived: 1,
      missing_code: 1,
      missing_sale_price: 1,
      zero_sale_price: 1,
      duplicate_source_sku: 2,
      ambiguous_medusa_sku: 1,
      processing_error: 0,
    })
    expect(plan.productsWithoutPrice).toEqual([
      "NO-PRICE — Грунт",
      "ZERO-PRICE — Грунт",
    ])
  })

  it("reuses an existing category path and plans only missing descendants", () => {
    const result = planCatalogCategories(
      [["Материалы", "Грунты"], ["Материалы", "Лаки"]],
      [
        {
          id: "category-materials",
          name: "Материалы",
          handle: "materials",
          parentCategoryId: null,
        },
        {
          id: "category-primers",
          name: "Грунты",
          handle: "primers",
          parentCategoryId: "category-materials",
        },
      ]
    )

    expect(result.missing.map((category) => category.fullPath)).toEqual([
      ["Материалы", "Лаки"],
    ])
    expect(
      result.categoryIdByPath.get(JSON.stringify(["Материалы", "Грунты"]))
    ).toBe("category-primers")
  })

  it("flattens MoySklad modifications into separate catalog variants", () => {
    const plan = buildCatalogImportPlan(
      [
        product({
          id: "paint",
          code: "PARENT-CODE",
          variants: [
            {
              id: "paint-red",
              name: "Красный 1 л",
              code: "PAINT-RED-1L",
              salePrices: [{ value: 25000, priceType: { name: "Цена продажи" } }],
              characteristics: [{ name: "Цвет", value: "Красный" }, { name: "Объём", value: "1 л" }],
            },
            {
              id: "paint-blue",
              name: "Синий 1 л",
              code: "PAINT-BLUE-1L",
              salePrices: [{ value: 26000, priceType: { name: "Цена продажи" } }],
              characteristics: [{ name: "Цвет", value: "Синий" }, { name: "Объём", value: "1 л" }],
            },
            { id: "paint-without-code", name: "Без кода" },
          ],
        }),
      ],
      new Map()
    )

    expect(plan.items.map((item) => [item.sku, item.variant?.name])).toEqual([
      ["PAINT-RED-1L", "Красный 1 л"],
      ["PAINT-BLUE-1L", "Синий 1 л"],
    ])
    expect(plan.skipped.missing_code).toBe(1)
  })

  it("plans an archived product for a matched Medusa product", () => {
    const plan = buildCatalogImportPlan(
      [product({ id: "archived", code: "ARCHIVED", archived: true })],
      new Map([
        ["ARCHIVED", [{ variantId: "variant-1", productId: "product-1", sku: "ARCHIVED" }]],
      ])
    )

    expect(plan.items).toMatchObject([
      { action: "archive", sku: "ARCHIVED", match: { productId: "product-1" } },
    ])
    expect(plan.skipped.archived).toBe(0)
  })

  it("paginates products and retries 429 after x-lognex-retry-after", async () => {
    const responses = [
      {
        ok: false,
        status: 429,
        headers: new Headers({ "x-lognex-retry-after": "1250" }),
        text: async () => "rate limited",
      },
      {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ meta: { size: 2 }, rows: [product({ id: "one" })] }),
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ meta: { size: 2 }, rows: [product({ id: "two" })] }),
        text: async () => "",
      },
    ]
    const fetch = jest.fn().mockImplementation(async () => responses.shift())
    const throttle = jest.fn().mockResolvedValue(undefined)
    const sleep = jest.fn().mockResolvedValue(undefined)

    const products = await fetchMoyskladCatalog({
      token: "token-from-env",
      fetch: fetch as never,
      throttle,
      sleep,
      pageSize: 1,
    })

    expect(products.map(({ id }) => id)).toEqual(["one", "two"])
    expect(sleep).toHaveBeenCalledWith(1250)
    expect(throttle).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.moysklad.ru/api/remap/1.2/entity/product?limit=1&offset=0&expand=variants,brand,tags,attributes",
      "https://api.moysklad.ru/api/remap/1.2/entity/product?limit=1&offset=0&expand=variants,brand,tags,attributes",
      "https://api.moysklad.ru/api/remap/1.2/entity/product?limit=1&offset=1&expand=variants,brand,tags,attributes",
    ])
    expect(fetch.mock.calls[0][1].headers.Accept).toBe(
      "application/json;charset=utf-8"
    )
  })

  it("fails before API access when either required environment variable is absent", () => {
    expect(() => readMoyskladEnvironment({})).toThrow(
      "MOYSKLAD_TOKEN и MOYSKLAD_ENCRYPTION_KEY"
    )
    expect(() =>
      readMoyskladEnvironment({ MOYSKLAD_TOKEN: "token" })
    ).toThrow("MOYSKLAD_TOKEN и MOYSKLAD_ENCRYPTION_KEY")
    expect(
      readMoyskladEnvironment({
        MOYSKLAD_TOKEN: "token",
        MOYSKLAD_ENCRYPTION_KEY: "key",
      })
    ).toEqual({ token: "token" })
  })
})
