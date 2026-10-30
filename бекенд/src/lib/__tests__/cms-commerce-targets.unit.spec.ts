import { filterInvalidCmsBanners } from "../cms-commerce-targets"

it("hides unavailable commerce banners but keeps external URLs", async () => {
  const container = { resolve: () => ({ graph: jest.fn().mockResolvedValue({ data: [] }) }) } as any
  const content = {
    revision: "r", sourceUpdatedAt: new Date().toISOString(), settings: {},
    sections: [{ __component: "sections.promo-banners", enabled: true, banners: [
      { enabled: true, target: { type: "product", medusaId: "missing" } },
      { enabled: true, target: { type: "external_url", url: "https://example.com" } },
      { enabled: false, target: { type: "external_url", url: "https://disabled.example.com" } },
    ] }],
  } as any
  const result = await filterInvalidCmsBanners(container, content)
  expect((result.sections[0] as any).banners).toHaveLength(1)
  expect((result.sections[0] as any).banners[0].target.type).toBe("external_url")
  expect((result.sections[0] as any).banners[0].target.url).toBe("https://example.com")
})

it("hides a category banner when any ancestor is private", async () => {
  const categories = [
    {
      id: "public-child",
      name: "Дочерняя категория",
      parent_category_id: "hidden-parent",
      is_active: true,
      is_internal: false,
    },
    {
      id: "hidden-parent",
      name: "Скрытая категория",
      parent_category_id: null,
      is_active: false,
      is_internal: false,
    },
  ]
  const graph = jest.fn().mockImplementation(async ({ filters }) => ({
    data: categories.filter(({ id }) => id === filters.id),
  }))
  const container = { resolve: () => ({ graph }) } as any
  const content = {
    revision: "r",
    sourceUpdatedAt: new Date().toISOString(),
    settings: {},
    sections: [
      {
        __component: "sections.promo-banners",
        enabled: true,
        banners: [
          {
            enabled: true,
            target: { type: "category", medusaId: "public-child" },
          },
        ],
      },
    ],
  } as any

  const result = await filterInvalidCmsBanners(container, content)

  expect(result.sections).toEqual([])
})
