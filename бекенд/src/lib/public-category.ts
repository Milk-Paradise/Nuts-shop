import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export type PublicCategory = {
  id: string
  name: string
  parent_category_id?: string | null
  is_active?: boolean
  is_internal?: boolean
}

type CategoryQuery = {
  graph(input: Record<string, unknown>): Promise<{ data: PublicCategory[] }>
}

const PUBLIC_CATEGORY_FIELDS = [
  "id",
  "name",
  "parent_category_id",
  "is_active",
  "is_internal",
]

function isPublic(category: PublicCategory) {
  return category.is_active !== false && category.is_internal !== true
}

async function categoryById(query: CategoryQuery, id: string) {
  const { data } = await query.graph({
    entity: "product_category",
    fields: PUBLIC_CATEGORY_FIELDS,
    filters: { id },
  })

  return data[0]
}

export async function findPublicCategoryById(
  container: MedusaContainer,
  id: string
): Promise<PublicCategory | undefined> {
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY
  ) as CategoryQuery
  const visited = new Set<string>()
  let categoryId: string | null | undefined = id
  let selectedCategory: PublicCategory | undefined

  while (categoryId) {
    if (visited.has(categoryId)) return undefined
    visited.add(categoryId)

    const category = await categoryById(query, categoryId)
    if (!category || !isPublic(category)) return undefined

    selectedCategory ??= category
    categoryId = category.parent_category_id
  }

  return selectedCategory
}

export async function findPublicCategoriesByName(
  container: MedusaContainer,
  name: string
): Promise<PublicCategory[]> {
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY
  ) as CategoryQuery
  const { data } = await query.graph({
    entity: "product_category",
    fields: PUBLIC_CATEGORY_FIELDS,
    filters: { name },
  })

  const publicCategories: PublicCategory[] = []
  for (const category of data) {
    const publicCategory = await findPublicCategoryById(container, category.id)
    if (publicCategory) publicCategories.push(publicCategory)
  }

  return publicCategories
}
