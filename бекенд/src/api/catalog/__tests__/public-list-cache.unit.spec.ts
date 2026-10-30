import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import {
  cachedPublicCatalogList,
  publicCatalogListCacheTtlSeconds,
} from "../public-list-cache"

function cacheFixture() {
  const values = new Map<string, unknown>()
  const expiresAt = new Map<string, number>()
  const cache = {
    get: jest.fn(async (key: string) => {
      if ((expiresAt.get(key) ?? Infinity) <= Date.now()) {
        values.delete(key)
        expiresAt.delete(key)
      }

      return values.get(key) ?? null
    }),
    set: jest.fn(async (key: string, value: unknown, ttl: number) => {
      values.set(key, value)
      expiresAt.set(key, Date.now() + ttl * 1000)
    }),
  }
  const container = {
    resolve(key: string) {
      if (key === Modules.CACHE) return cache
      throw new Error("Unexpected dependency: " + key)
    },
  } as MedusaContainer

  return { cache, container }
}

describe("public catalog list cache", () => {
  afterEach(() => {
    delete process.env.CATALOG_PUBLIC_LIST_CACHE_TTL_SECONDS
    jest.useRealTimers()
  })

  it("reuses cached lists and reads a fresh value after the configured TTL", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    process.env.CATALOG_PUBLIC_LIST_CACHE_TTL_SECONDS = "5"
    const { cache, container } = cacheFixture()
    const source = jest
      .fn()
      .mockResolvedValueOnce(["first"])
      .mockResolvedValueOnce(["fresh"])

    await expect(
      cachedPublicCatalogList(container, "catalog:public-list:v1:brands", source)
    ).resolves.toEqual(["first"])
    await expect(
      cachedPublicCatalogList(container, "catalog:public-list:v1:brands", source)
    ).resolves.toEqual(["first"])
    expect(source).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith(
      "catalog:public-list:v1:brands",
      ["first"],
      5
    )

    jest.advanceTimersByTime(5_000)

    await expect(
      cachedPublicCatalogList(container, "catalog:public-list:v1:brands", source)
    ).resolves.toEqual(["fresh"])
    expect(source).toHaveBeenCalledTimes(2)
  })

  it("uses five minutes when the TTL is absent or invalid", () => {
    expect(publicCatalogListCacheTtlSeconds()).toBe(300)
    process.env.CATALOG_PUBLIC_LIST_CACHE_TTL_SECONDS = "0"
    expect(publicCatalogListCacheTtlSeconds()).toBe(300)
  })
})
