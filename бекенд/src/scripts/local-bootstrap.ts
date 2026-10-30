import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { COMMERCE_BASELINE, seedCommerceBaseline } from "./seed-commerce"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

// Creates commerce settings only. Products are added using the Admin API.
export default async function bootstrap({ container }: ExecArgs) {
  Object.assign(COMMERCE_BASELINE, {
    salesChannelName: "Nuts Store",
    apiKeyTitle: "Nuts Store Local Storefront",
    storeName: "Nuts Store",
  })
  const baseline = await seedCommerceBaseline(container)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: keys } = await query.graph({ entity: "api_key", fields: ["id", "token"], filters: { id: baseline.publishableApiKey.id } })
  const configPath = process.env.NUTS_CONFIG_PATH || resolve(process.cwd(), "../.local/catalog.json")
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify({
    publishableKey: keys[0].token,
    salesChannelId: baseline.salesChannel.id,
    stockLocationId: baseline.stockLocation.id,
    shippingProfileId: baseline.shippingProfile.id,
    regionId: baseline.region.id,
  }, null, 2))
}
