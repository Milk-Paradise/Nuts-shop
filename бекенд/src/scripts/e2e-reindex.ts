import type { ExecArgs } from "@medusajs/framework/types"

import { reindexCatalogDocuments } from "../modules/meilisearch/sync"

export default async function e2eReindex({ container }: ExecArgs) {
  const result = await reindexCatalogDocuments(container)

  console.log(`[e2e-reindex] indexed=${result.indexed} deleted=${result.deleted} skipped=${result.skipped}`)
  console.log(`E2E_REINDEX_RESULT=${JSON.stringify(result)}`)
}
