import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { reindexCatalogDocuments } from "../modules/meilisearch/sync"

export default async function reindexCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const result = await reindexCatalogDocuments(container)

  logger.info(
    `Catalog reindex complete: ${result.indexed} document(s) indexed, ${result.skipped} product(s) skipped (draft or missing title/price/category).`
  )
}
