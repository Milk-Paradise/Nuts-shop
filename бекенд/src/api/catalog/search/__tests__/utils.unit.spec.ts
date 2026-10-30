import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { MEILISEARCH_MODULE } from "../../../../modules/meilisearch"
import type { CatalogIndexDocument } from "../../../../modules/meilisearch/documents"
import {
  normalizeCatalogSearchQuery,
  searchCatalogProducts,
} from "../utils"
import {
  GetCatalogSearchSchema,
  type GetCatalogSearchQuery,
} from "../../validators"

function document(
  overrides: Partial<CatalogIndexDocument> = {}
): CatalogIndexDocument {
  return {
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
    ...overrides,
  }
}

function createContainer(
  service: Record<string, unknown>,
  categories: Array<{
    id: string
    name: string
    parent_category_id: string | null
    is_active: boolean
    is_internal: boolean
  }> = [
    {
      id: "pcat_root",
      name: "Грунты",
      parent_category_id: null,
      is_active: true,
      is_internal: false,
    },
  ]
) {
  const graph = jest.fn().mockImplementation(async ({ filters }) => ({
    data: categories.filter((category) =>
      filters.id ? category.id === filters.id : category.name === filters.name
    ),
  }))

  return {
    resolve(key: string) {
      if (key === MEILISEARCH_MODULE) {
        return service
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return { graph }
      }

      throw new Error(`Unexpected container key: ${key}`)
    },
  } as MedusaContainer
}

describe("catalog search query validation", () => {
  it("normalizes invalid query params without validation errors", () => {
    const parsed = GetCatalogSearchSchema.parse({
      q: "  грунт  ",
      category: [" Грунты "],
      availability: "missing",
      min_price: "not-a-number",
      max_price: "-10",
      page: "-2",
      limit: "0",
    })

    expect(parsed.q).toBe("грунт")
    expect(parsed.category).toBe("Грунты")
    expect(parsed.availability).toBeUndefined()
    expect(parsed.min_price).toBeUndefined()
    expect(parsed.max_price).toBeUndefined()
    expect(parsed.page).toBeUndefined()
    expect(parsed.limit).toBeUndefined()
  })

  it("swaps inverted price ranges and clamps excessive page size", () => {
    const parsed = GetCatalogSearchSchema.parse({
      min_price: "700",
      max_price: "600",
      page: "2",
      limit: "500",
    })

    expect(normalizeCatalogSearchQuery(parsed)).toEqual(
      expect.objectContaining({
        min_price: 600,
        max_price: 700,
        page: 2,
        limit: 100,
      })
    )
  })
})

describe("searchCatalogProducts", () => {
  it("builds Meilisearch filters, pagination and query sorting", async () => {
    const service = {
      hasCatalogDocumentsMatching: jest.fn().mockResolvedValue(true),
      searchCatalogDocuments: jest.fn().mockResolvedValue({
        hits: [
          document(),
          document({
            id: "prod_multi",
            variant_id: null,
            max_quantity: null,
            articles: ["PRIMER-GREY-1L", "PRIMER-GREY-3L"],
          }),
        ],
        totalHits: 2,
        page: 2,
        hitsPerPage: 10,
      facets: ["categories", "brand", "availability"],
        totalPages: 3,
        processingTimeMs: 4,
        query: "primer",
      }),
    }

    const response = await searchCatalogProducts(createContainer(service), {
      q: "primer",
      category: "Грунты",
      brand: 'ACME "Pro"',
      availability: "in_stock",
      min_price: 700,
      max_price: 600,
      page: 2,
      limit: 10,
      sort: "relevance",
    } satisfies GetCatalogSearchQuery)

    expect(service.hasCatalogDocumentsMatching).not.toHaveBeenCalled()
    expect(service.searchCatalogDocuments).toHaveBeenCalledWith({
      query: "primer",
      filter: [
        '(category_ids = "pcat_root")',
        'brand = "ACME \\"Pro\\""',
        'availability = "in_stock"',
        "price >= 600",
        "price <= 700",
      ],
      sort: ["availability_rank:asc"],
      page: 2,
      hitsPerPage: 10,
      facets: ["categories", "brand", "availability"],
    })
    expect(response).toEqual(
      expect.objectContaining({
        total: 2,
        page: 2,
        limit: 10,
        pages: 3,
        query: "primer",
        processing_time_ms: 4,
      })
    )
    expect(response.filters).toEqual({
      category: "Грунты",
      brand: 'ACME "Pro"',
      availability: "in_stock",
      min_price: 600,
      max_price: 700,
    })
    expect(response.products.map((product) => product.article)).toEqual([
      "PRIMER-GREY-1L",
      null,
    ])
    expect(response.products.map((product) => product.variant_id)).toEqual([
      "variant_1",
      null,
    ])
    expect(response.products.map((product) => product.max_quantity)).toEqual([
      10,
      null,
    ])
    expect(response.products).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ search_keywords: expect.anything() }),
      ]),
    )
    expect(response.products).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ searchKeywords: expect.anything() }),
      ]),
    )
  })

  it("returns not found for an unknown category instead of dropping its filter", async () => {
    const service = {
      hasCatalogDocumentsMatching: jest.fn().mockResolvedValue(false),
      searchCatalogDocuments: jest.fn().mockResolvedValue({
        hits: [],
        totalHits: 0,
        page: 1,
        hitsPerPage: 24,
      facets: ["categories", "brand", "availability"],
        totalPages: 0,
        processingTimeMs: 1,
        query: "",
      }),
    }

    await expect(
      searchCatalogProducts(createContainer(service), {
        category: "Нет такой категории",
        sort: "relevance",
      } satisfies GetCatalogSearchQuery)
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
    expect(service.searchCatalogDocuments).not.toHaveBeenCalled()
  })

  it("returns not found when a category has a hidden ancestor", async () => {
    const service = { searchCatalogDocuments: jest.fn() }
    const categories = [
      {
        id: "pcat_child",
        name: "Спецгрунты",
        parent_category_id: "pcat_hidden",
        is_active: true,
        is_internal: false,
      },
      {
        id: "pcat_hidden",
        name: "Скрытые",
        parent_category_id: null,
        is_active: false,
        is_internal: false,
      },
    ]

    await expect(
      searchCatalogProducts(createContainer(service, categories), {
        category_id: "pcat_child",
        sort: "relevance",
      } satisfies GetCatalogSearchQuery)
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
    expect(service.searchCatalogDocuments).not.toHaveBeenCalled()
  })

  it("filters duplicate category names to the public category identity", async () => {
    const service = {
      searchCatalogDocuments: jest.fn().mockResolvedValue({
        hits: [],
        totalHits: 0,
        page: 1,
        hitsPerPage: 24,
        totalPages: 0,
        processingTimeMs: 1,
        query: "",
      }),
    }
    const categories = [
      {
        id: "public-root",
        name: "Открытая ветка",
        parent_category_id: null,
        is_active: true,
        is_internal: false,
      },
      {
        id: "public-child",
        name: "Одинаковое имя",
        parent_category_id: "public-root",
        is_active: true,
        is_internal: false,
      },
      {
        id: "hidden-root",
        name: "Скрытая ветка",
        parent_category_id: null,
        is_active: false,
        is_internal: false,
      },
      {
        id: "hidden-child",
        name: "Одинаковое имя",
        parent_category_id: "hidden-root",
        is_active: true,
        is_internal: false,
      },
    ]

    await searchCatalogProducts(createContainer(service, categories), {
      category: "Одинаковое имя",
      sort: "relevance",
    } satisfies GetCatalogSearchQuery)

    expect(service.searchCatalogDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ filter: ['(category_ids = "public-child")'] })
    )
  })
})
