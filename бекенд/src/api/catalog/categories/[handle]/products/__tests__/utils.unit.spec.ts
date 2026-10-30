import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

import { listCategoryProducts } from "../utils"

function inventoryItems(stocked: number) {
  return [
    {
      required_quantity: 1,
      inventory: {
        location_levels: [
          { stocked_quantity: stocked, reserved_quantity: 0 },
        ],
      },
    },
  ]
}

function product(
  id: string,
  title: string,
  options: {
    stocked?: number
    allowBackorder?: boolean
    categoryId?: string
  } = {}
) {
  return {
    id,
    title,
    status: "published",
    thumbnail: null,
    metadata: null,
    categories: [{ id: options.categoryId ?? "pcat_root", name: "Грунты" }],
    variants: [
      {
        id: `variant_${id}`,
        title: "1 л",
        sku: `SKU-${id}`,
        manage_inventory: true,
        allow_backorder: options.allowBackorder ?? false,
        price_set: {
          prices: [{ amount: 1000, currency_code: "rub" }],
        },
        inventory_items: inventoryItems(options.stocked ?? 1),
      },
    ],
  }
}

function flattenCategories(categories: Record<string, any>[]): Record<string, any>[] {
  return categories.flatMap((category) => [
    category,
    ...flattenCategories(category.category_children ?? []),
  ])
}

function createContainer(
  products: Record<string, unknown>[],
  categories?: unknown[],
  categoryRecords?: Record<string, any>[]
) {
  const categoryTree = (categories ?? [
      {
        id: "pcat_root",
        name: "Грунты",
        handle: "grunty",
        is_active: true,
        is_internal: false,
        category_children: [
          {
            id: "pcat_child",
            name: "Спецгрунты",
            handle: "spetsgrunty",
            is_active: true,
            is_internal: false,
            category_children: [
              {
                id: "pcat_grandchild",
                name: "Эпоксидные грунты",
                handle: "epoksidnye-grunty",
                is_active: true,
                is_internal: false,
                category_children: [],
              },
            ],
          },
        ],
      },
    ]) as Record<string, any>[]
  const listProductCategories = jest.fn().mockResolvedValue(categoryTree)
  const listProducts = jest.fn().mockImplementation(async (filters, config) => {
    const skip = config?.skip ?? 0
    const take = config?.take ?? products.length
    const categoryIds = new Set(filters.categories.id)
    const matchingProducts = products.filter((item) =>
      (item.categories as { id: string }[]).some((category) =>
        categoryIds.has(category.id)
      )
    )

    return matchingProducts.slice(skip, skip + take).map(({ id }) => ({ id }))
  })
  const allCategories = categoryRecords ?? flattenCategories(categoryTree)
  const graph = jest.fn().mockImplementation(async ({ entity, filters }) => {
    if (entity === "product_category") {
      const category = allCategories.find(({ id }) => id === filters.id)
      return { data: category ? [category] : [] }
    }

    const ids = new Set(filters.id)
    const data = products.filter(({ id }) => ids.has(id))

    return { data, metadata: { count: products.length } }
  })

  const container = {
    resolve(key: string) {
      if (key === Modules.PRODUCT) {
        return { listProductCategories, listProducts }
      }

      if (key === ContainerRegistrationKeys.QUERY) {
        return { graph }
      }

      throw new Error(`Unexpected container key: ${key}`)
    },
  } as MedusaContainer

  return { container, graph, listProductCategories, listProducts }
}

describe("listCategoryProducts", () => {
  it("includes the full descendant tree, applies catalog sorting, and paginates by 24", async () => {
    const products = [
      ...Array.from({ length: 24 }, (_, index) =>
        product(`in_${index}`, `В наличии ${String(index).padStart(2, "0")}`)
      ),
      product("backorder", "А под заказ", {
        stocked: 0,
        allowBackorder: true,
      }),
      product("out", "А нет в наличии", { stocked: 0 }),
    ]
    const { container, graph, listProductCategories, listProducts } =
      createContainer(products)

    const result = await listCategoryProducts(container, "grunty", 2)

    expect(listProductCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: "grunty",
        include_descendants_tree: true,
        is_active: true,
        is_internal: false,
      }),
      expect.any(Object)
    )
    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "published",
        categories: {
          id: ["pcat_root", "pcat_child", "pcat_grandchild"],
        },
      }),
      expect.objectContaining({ take: 250, skip: 0, order: { id: "ASC" } })
    )
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "product", filters: { id: expect.any(Array) } })
    )
    expect(result).toEqual({
      category: { id: "pcat_root", name: "Грунты", handle: "grunty" },
      products: [
        expect.objectContaining({ id: "backorder", availability: "backorder" }),
        expect.objectContaining({ id: "out", availability: "out_of_stock" }),
      ],
      total: 26,
      page: 2,
      limit: 24,
      pages: 2,
    })
  })

  it("returns not found when the public category handle does not exist", async () => {
    const { container } = createContainer([], [])

    await expect(
      listCategoryProducts(container, "missing", 1)
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
  })

  it.each([
    { is_active: false, is_internal: false },
    { is_active: true, is_internal: true },
  ])("returns not found for a non-public root category", async (visibility) => {
    const { container, listProducts } = createContainer([], [
      {
        id: "pcat_root",
        name: "Грунты",
        handle: "grunty",
        ...visibility,
        category_children: [],
      },
    ])

    await expect(
      listCategoryProducts(container, "grunty", 1)
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(listProducts).not.toHaveBeenCalled()
  })

  it("filters products to a selected subcategory and all of its descendants", async () => {
    const products = [
      product("root", "Корневой товар"),
      product("child", "Товар подкатегории", { categoryId: "pcat_child" }),
      product("grandchild", "Товар вложенной категории", {
        categoryId: "pcat_grandchild",
      }),
    ]
    const { container, listProducts } = createContainer(products)

    const result = await listCategoryProducts(
      container,
      "grunty",
      1,
      "spetsgrunty"
    )

    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: { id: ["pcat_child", "pcat_grandchild"] },
      }),
      expect.any(Object)
    )
    expect(result.products.map(({ id }) => id)).toEqual(["grandchild", "child"])
    expect(result.total).toBe(2)
  })

  it("returns not found for a selected subcategory outside the requested tree", async () => {
    const { container, listProducts } = createContainer([])

    await expect(
      listCategoryProducts(container, "grunty", 1, "chuzhaya-kategoriya")
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(listProducts).not.toHaveBeenCalled()
  })

  it("returns not found when a public category has a hidden ancestor", async () => {
    const category = {
      id: "pcat_child",
      name: "Спецгрунты",
      handle: "spetsgrunty",
      parent_category_id: "pcat_hidden",
      is_active: true,
      is_internal: false,
      category_children: [],
    }
    const { container, listProducts } = createContainer(
      [],
      [category],
      [
        category,
        {
          id: "pcat_hidden",
          parent_category_id: null,
          is_active: false,
          is_internal: false,
        },
      ]
    )

    await expect(
      listCategoryProducts(container, "spetsgrunty", 1)
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
    expect(listProducts).not.toHaveBeenCalled()
  })

  it.each([
    { is_active: false, is_internal: false },
    { is_active: true, is_internal: true },
  ])(
    "returns not found for a selected non-public subcategory",
    async (visibility) => {
      const { container, listProducts } = createContainer([], [
        {
          id: "pcat_root",
          name: "Грунты",
          handle: "grunty",
          is_active: true,
          is_internal: false,
          category_children: [
            {
              id: "pcat_hidden",
              name: "Скрытая категория",
              handle: "skrytaya",
              ...visibility,
              category_children: [],
            },
          ],
        },
      ])

      await expect(
        listCategoryProducts(container, "grunty", 1, "skrytaya")
      ).rejects.toMatchObject({
        type: MedusaError.Types.NOT_FOUND,
      })
      expect(listProducts).not.toHaveBeenCalled()
    }
  )

  it("excludes non-public category subtrees from the unfiltered product list", async () => {
    const products = [
      product("root", "Открытый товар"),
      product("hidden", "Скрытый товар", { categoryId: "pcat_hidden" }),
      product("hidden-child", "Товар скрытого потомка", {
        categoryId: "pcat_hidden_child",
      }),
    ]
    const { container, listProducts } = createContainer(products, [
      {
        id: "pcat_root",
        name: "Грунты",
        handle: "grunty",
        is_active: true,
        is_internal: false,
        category_children: [
          {
            id: "pcat_hidden",
            name: "Скрытая категория",
            handle: "skrytaya",
            is_active: false,
            is_internal: false,
            category_children: [
              {
                id: "pcat_hidden_child",
                name: "Потомок скрытой категории",
                handle: "potomok-skrytoy",
                is_active: true,
                is_internal: false,
                category_children: [],
              },
            ],
          },
        ],
      },
    ])

    const result = await listCategoryProducts(container, "grunty", 1)

    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ categories: { id: ["pcat_root"] } }),
      expect.any(Object)
    )
    expect(result.products.map(({ id }) => id)).toEqual(["root"])
  })

  it("returns not found for a public descendant of a non-public category", async () => {
    const { container, listProducts } = createContainer([], [
      {
        id: "pcat_root",
        name: "Грунты",
        handle: "grunty",
        is_active: true,
        is_internal: false,
        category_children: [
          {
            id: "pcat_hidden",
            name: "Скрытая категория",
            handle: "skrytaya",
            is_active: false,
            is_internal: false,
            category_children: [
              {
                id: "pcat_hidden_child",
                name: "Открытый потомок",
                handle: "otkrytyy-potomok",
                is_active: true,
                is_internal: false,
                category_children: [],
              },
            ],
          },
        ],
      },
    ])

    await expect(
      listCategoryProducts(container, "grunty", 1, "otkrytyy-potomok")
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(listProducts).not.toHaveBeenCalled()
  })

  it("reads category products in stable batches beyond 250 records", async () => {
    const products = Array.from({ length: 251 }, (_, index) =>
      product(`product_${String(index).padStart(3, "0")}`, `Товар ${index}`)
    )
    const { container, graph, listProducts } = createContainer(products)

    const result = await listCategoryProducts(container, "grunty", 11)

    expect(listProducts).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ take: 250, skip: 250, order: { id: "ASC" } })
    )
    expect(graph).toHaveBeenCalledTimes(3)
    expect(result).toEqual(
      expect.objectContaining({ total: 251, page: 11, limit: 24, pages: 11 })
    )
    expect(result.products).toHaveLength(11)
  })
})
