import type { ICacheService, MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const DEFAULT_PUBLIC_LIST_CACHE_TTL_SECONDS = 300

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function publicCatalogListCacheTtlSeconds(): number {
  return positiveInteger(
    process.env.CATALOG_PUBLIC_LIST_CACHE_TTL_SECONDS,
    DEFAULT_PUBLIC_LIST_CACHE_TTL_SECONDS
  )
}

export async function cachedPublicCatalogList<T>(
  container: MedusaContainer,
  key: string,
  source: () => Promise<T>
): Promise<T> {
  let cache: ICacheService

  try {
    cache = container.resolve<ICacheService>(Modules.CACHE)
    const cached = await cache.get<T>(key)

    if (cached !== null) {
      return cached
    }
  } catch {
    return source()
  }

  const value = await source()

  try {
    await cache.set(key, value, publicCatalogListCacheTtlSeconds())
  } catch {
    // Public catalog reads stay available if Redis is temporarily unavailable.
  }

  return value
}
