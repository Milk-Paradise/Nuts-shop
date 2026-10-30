import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  productIdsByInventoryEntityIds,
  productIdsByVariantIds,
  reindexCatalogDocuments,
  syncCatalogProductsByIds,
} from "../sync"
import { MEILISEARCH_MODULE } from ".."

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

function createContainer({
  inventoryItems = [],
  inventoryLevels = [],
  products = [],
  reservationItems = [],
  variants = [],
}: {
  inventoryItems?: Record<string, any>[]
  inventoryLevels?: Record<string, any>[]
  products?: Record<string, any>[]
  reservationItems?: Record<string, any>[]
  variants?: Record<string, any>[]
}) {
  const categories = [
    { id: "cat_root", name: "Грунты", parent_category_id: null },
    { id: "cat_child", name: "Грунты акриловые", parent_category_id: "cat_root" },
  ]
  const service = {
    configureCatalogIndex: jest.fn().mockResolvedValue(undefined),
    upsertCatalogDocuments: jest.fn().mockResolvedValue(undefined),
    deleteCatalogDocuments: jest.fn().mockResolvedValue(undefined),
    resetCatalogIndex: jest.fn().mockResolvedValue(undefined),
  }
  const query = {
    graph: jest.fn(async ({ entity, filters }: Record<string, any>) => {
      if (entity === "product_category") {
        return { data: categories }
      }

      if (entity === "product") {
        const ids = filters?.id
          ? Array.isArray(filters.id)
            ? filters.id
            : [filters.id]
          : null

        return {
          data: ids
            ? products.filter((item) => ids.includes(item.id))
            : products,
        }
      }

      if (entity === "product_variant") {
        const ids = filters?.id
          ? Array.isArray(filters.id)
            ? filters.id
            : [filters.id]
          : []

        return {
          data: variants.filter((item) => ids.includes(item.id)),
        }
      }

      if (entity === "inventory_item") {
        const ids = Array.isArray(filters?.id) ? filters.id : [filters?.id]

        return {
          data: inventoryItems.filter((item) => ids.includes(item.id)),
        }
      }

      if (entity === "inventory_level") {
        const ids = Array.isArray(filters?.id) ? filters.id : [filters?.id]

        return {
          data: inventoryLevels.filter((item) => ids.includes(item.id)),
        }
      }

      if (entity === "reservation_item") {
        const ids = Array.isArray(filters?.id) ? filters.id : [filters?.id]

        return {
          data: reservationItems.filter((item) => ids.includes(item.id)),
        }
      }

      return { data: [] }
    }),
  }

  return {
    container: {
      resolve(key: string) {
        if (key === ContainerRegistrationKeys.QUERY) {
          return query
        }

        if (key === MEILISEARCH_MODULE) {
          return service
        }

        throw new Error(`Unexpected container key: ${key}`)
      },
    } as MedusaContainer,
    query,
    service,
  }
}

describe("catalog index sync helpers", () => {
  it("upserts valid products and deletes missing or invalid products", async () => {
    const valid = product({
      metadata: { brand: "Novol", search_keywords: ["аэрозоль"] },
    })
    const draft = product({ id: "prod_draft", status: "draft" })
    const { container, service } = createContainer({
      products: [valid, draft],
    })

    const result = await syncCatalogProductsByIds(container, [
      valid.id,
      draft.id,
      "prod_missing",
    ])

    expect(result).toEqual({
      indexed: 1,
      deleted: 2,
      skipped: 1,
    })
    expect(service.configureCatalogIndex).toHaveBeenCalledTimes(1)
    expect(service.upsertCatalogDocuments).toHaveBeenCalledWith([
      expect.objectContaining({
        id: valid.id,
        title: valid.title,
        variant_id: "variant_1",
        articles: ["PRIMER-GREY-1L"],
        categories: ["Грунты", "Грунты акриловые"],
        category_ids: ["cat_root", "cat_child"],
        search_keywords: ["аэрозоль"],
      }),
    ])
    expect(service.deleteCatalogDocuments).toHaveBeenCalledWith([
      "prod_missing",
      draft.id,
    ])
  })

  it("resets the full catalog index from all products", async () => {
    const valid = product({
      metadata: { brand: "Novol", search_keywords: [" аэрозоль "] },
    })
    const withoutPrice = product({
      id: "prod_without_price",
      variants: [
        {
          id: "variant_no_price",
          sku: "NO-PRICE",
          manage_inventory: true,
          price_set: { prices: [] },
          inventory_items: inventoryItems(10),
        },
      ],
    })
    const { container, service } = createContainer({
      products: [valid, withoutPrice],
    })

    const result = await reindexCatalogDocuments(container)

    expect(result).toEqual({
      indexed: 1,
      deleted: 0,
      skipped: 1,
    })
    expect(service.resetCatalogIndex).toHaveBeenCalledWith([
      expect.objectContaining({
        id: valid.id,
        search_keywords: ["аэрозоль"],
      }),
    ])
  })

  it("resolves product ids from product variant ids", async () => {
    const { container } = createContainer({
      variants: [
        { id: "variant_1", product_id: "prod_1" },
        { id: "variant_2", product_id: "prod_2" },
      ],
    })

    await expect(
      productIdsByVariantIds(container, ["variant_1", "variant_2"])
    ).resolves.toEqual(["prod_1", "prod_2"])
  })

  it.each([
    ["inventory_item", "iitem_1"],
    ["inventory_level", "ilev_1"],
    ["reservation_item", "resitem_1"],
  ] as const)(
    "resolves affected product ids from %s ids",
    async (entity, entityId) => {
      const { container } = createContainer({
        inventoryItems: [
          {
            id: "iitem_1",
            variants: [
              { id: "variant_1", product_id: "prod_1" },
              { id: "variant_2", product_id: "prod_2" },
            ],
          },
        ],
        inventoryLevels: [
          { id: "ilev_1", inventory_item_id: "iitem_1" },
        ],
        reservationItems: [
          { id: "resitem_1", inventory_item_id: "iitem_1" },
        ],
      })

      await expect(
        productIdsByInventoryEntityIds(container, entity, [entityId])
      ).resolves.toEqual(["prod_1", "prod_2"])
    }
  )
})
