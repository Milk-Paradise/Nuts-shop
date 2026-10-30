import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { cachedPublicCatalogList } from "../public-list-cache"

export type CategoryTreeNode = {
  id: string
  name: string
  handle: string
  children: CategoryTreeNode[]
}

type SourceCategory = {
  id: string
  name: string
  handle: string
  parent_category_id: string | null
  rank: number
}

const CATEGORY_TREE_BATCH_SIZE = 250

export async function listCategoryTree(
  container: MedusaContainer
): Promise<CategoryTreeNode[]> {
  return cachedPublicCatalogList(
    container,
    "catalog:public-list:v1:category-tree",
    async () => {
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const categories: SourceCategory[] = []

      for (let skip = 0; ; skip += CATEGORY_TREE_BATCH_SIZE) {
        const { data } = await query.graph({
          entity: "product_category",
          fields: ["id", "name", "handle", "parent_category_id", "rank"],
          filters: { is_active: true, is_internal: false },
          pagination: {
            take: CATEGORY_TREE_BATCH_SIZE,
            skip,
            order: { id: "ASC" },
          },
        })
        const batch = data as SourceCategory[]
        categories.push(...batch)

        if (batch.length < CATEGORY_TREE_BATCH_SIZE) break
      }

      const childrenByParent = new Map<string | null, SourceCategory[]>()

      for (const category of categories) {
        const parentId = category.parent_category_id ?? null
        const siblings = childrenByParent.get(parentId) ?? []
        siblings.push(category)
        childrenByParent.set(parentId, siblings)
      }

      function buildNodes(parentId: string | null): CategoryTreeNode[] {
        const siblings = childrenByParent.get(parentId) ?? []

        return siblings
          .sort(
            (left, right) =>
              left.rank - right.rank || left.name.localeCompare(right.name, "ru")
          )
          .map((category) => ({
            id: category.id,
            name: category.name,
            handle: category.handle,
            children: buildNodes(category.id),
          }))
      }

      return buildNodes(null)
    }
  )
}
