import { model } from "@medusajs/framework/utils"

export type CdekCacheKeyInput = {
  country_code: string
  city: string
  region?: string | null
  postal_code?: string | null
}

export type CdekCacheKey = {
  country_code: string
  city: string
  region: string
  postal_code: string
}

const normalizeName = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase()

export const normalizeCdekCacheKey = (input: CdekCacheKeyInput): CdekCacheKey => ({
  country_code: input.country_code.trim().toUpperCase(),
  city: normalizeName(input.city),
  region: normalizeName(input.region ?? ""),
  postal_code: input.postal_code?.trim() ?? "",
})

const ShippingCdekCityResolutionCache = model
  .define("shipping_cdek_city_resolution_cache", {
    id: model.id().primaryKey(),
    country_code: model.text(),
    city: model.text(),
    region: model.text().default(""),
    postal_code: model.text().default(""),
    city_code: model.number(),
    candidate: model.json(),
    fetched_at: model.dateTime(),
    expires_at: model.dateTime(),
  })
  .indexes([
    {
      name: "IDX_shipping_cdek_city_resolution_cache_key_unique",
      on: ["country_code", "city", "region", "postal_code"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default ShippingCdekCityResolutionCache
