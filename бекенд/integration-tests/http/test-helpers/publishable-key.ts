import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"

async function queryFirst(
  container: MedusaContainer,
  entity: string,
  fields: string[],
  filters?: Record<string, unknown>
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity, fields, filters })
  return data[0]
}

// `/store/*` requires `x-publishable-api-key` on every request (backend
// CLAUDE.md, "Единая дверь: пространство /store"). Suites that don't need a
// full commerce baseline (seedCommerceBaseline) still need a key bound to a
// sales channel to call any /store route at all. Mirrors the idempotent
// get-or-create pattern from src/scripts/seed-commerce.ts.
export async function ensureTestPublishableApiKey(
  container: MedusaContainer,
  titleSuffix: string
) {
  const salesChannelName = `Test channel ${titleSuffix}`
  const salesChannel =
    (await queryFirst(container, "sales_channel", ["id"], { name: salesChannelName })) ??
    (
      await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: salesChannelName }] },
      })
    ).result[0]

  const apiKeyTitle = `Test key ${titleSuffix}`
  const apiKey =
    (await queryFirst(container, "api_key", ["id", "token"], {
      title: apiKeyTitle,
      type: "publishable",
    })) ??
    (
      await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [{ title: apiKeyTitle, type: "publishable", created_by: "" }],
        },
      })
    ).result[0]

  const isLinked = await queryFirst(
    container,
    "publishable_api_key_sales_channel",
    ["id"],
    { publishable_key_id: apiKey.id, sales_channel_id: salesChannel.id }
  )

  if (!isLinked) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: apiKey.id, add: [salesChannel.id] },
    })
  }

  return { token: apiKey.token as string, salesChannelId: salesChannel.id as string }
}
