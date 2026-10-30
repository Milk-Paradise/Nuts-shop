import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils"

import { cachedPublicCatalogList } from "../public-list-cache"

type SourceProduct = {
  metadata?: Record<string, unknown> | null
}

export async function listCatalogBrands(
  container: MedusaContainer
): Promise<string[]> {
  return cachedPublicCatalogList(
    container,
    "catalog:public-list:v1:brands",
    async () => {
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "product",
        fields: ["metadata"],
        filters: { status: ProductStatus.PUBLISHED },
        pagination: {
          take: 1000,
          skip: 0,
        },
      })

      const brands = new Set<string>()

      for (const product of data as SourceProduct[]) {
        const brand = product.metadata?.brand
        if (typeof brand === "string" && brand.trim()) {
          brands.add(brand.trim())
        }
      }

      return [...brands].sort((left, right) => left.localeCompare(right, "ru"))
    }
  )
}
