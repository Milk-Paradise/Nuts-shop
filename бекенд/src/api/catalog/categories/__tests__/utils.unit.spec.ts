import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { listCategoryTree } from "../utils"

describe("listCategoryTree", () => {
  it("builds the public hierarchy in administrator rank order", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [
        {
          id: "root_second",
          name: "Вторая",
          handle: "second",
          parent_category_id: null,
          rank: 1,
        },
        {
          id: "child_second",
          name: "Дочерняя вторая",
          handle: "child-second",
          parent_category_id: "root_first",
          rank: 1,
        },
        {
          id: "root_first",
          name: "Первая",
          handle: "first",
          parent_category_id: null,
          rank: 0,
        },
        {
          id: "child_first",
          name: "Дочерняя первая",
          handle: "child-first",
          parent_category_id: "root_first",
          rank: 0,
        },
        {
          id: "orphan",
          name: "Скрытая ветка",
          handle: "orphan",
          parent_category_id: "filtered_parent",
          rank: 0,
        },
      ],
    })
    const container = {
      resolve(key: string) {
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`Unexpected container key: ${key}`)
      },
    } as MedusaContainer

    const result = await listCategoryTree(container)

    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product_category",
        fields: expect.arrayContaining(["parent_category_id", "rank"]),
        filters: { is_active: true, is_internal: false },
      })
    )
    expect(result).toEqual([
      {
        id: "root_first",
        name: "Первая",
        handle: "first",
        children: [
          {
            id: "child_first",
            name: "Дочерняя первая",
            handle: "child-first",
            children: [],
          },
          {
            id: "child_second",
            name: "Дочерняя вторая",
            handle: "child-second",
            children: [],
          },
        ],
      },
      {
        id: "root_second",
        name: "Вторая",
        handle: "second",
        children: [],
      },
    ])
  })

  it("reads every batch instead of truncating large trees", async () => {
    const firstBatch = Array.from({ length: 250 }, (_, index) => ({
      id: `root_${String(index).padStart(3, "0")}`,
      name: `Категория ${index}`,
      handle: `category-${index}`,
      parent_category_id: null,
      rank: index,
    }))
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: firstBatch })
      .mockResolvedValueOnce({
        data: [
          {
            id: "root_250",
            name: "Категория 250",
            handle: "category-250",
            parent_category_id: null,
            rank: 250,
          },
        ],
      })
    const container = {
      resolve(key: string) {
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`Unexpected container key: ${key}`)
      },
    } as MedusaContainer

    const result = await listCategoryTree(container)

    expect(result).toHaveLength(251)
    expect(graph).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        pagination: { take: 250, skip: 0, order: { id: "ASC" } },
      })
    )
    expect(graph).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pagination: { take: 250, skip: 250, order: { id: "ASC" } },
      })
    )
  })
})
