import {
  MoyskladClient,
  createMoyskladRateLimiter,
  type MoyskladProduct,
  type MoyskladStockBatch,
  type MoyskladFetch,
  type MoyskladFetchResponse
} from "../client"
import { encryptMoyskladCredentials } from "../credentials"

function successfulJson(value: unknown): MoyskladFetchResponse {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(value),
    json: async () => value
  }
}

describe("MoyskladClient stock batches", () => {
  beforeEach(() => {
    process.env.MOYSKLAD_ENCRYPTION_KEY = "test-moysklad-encryption-key"
  })

  it("loads the stock report in pages instead of requesting each catalog item", async () => {
    const pages = [
      {
        meta: { size: 5 },
        rows: [
          { meta: { href: "product-1" }, code: "SKU-1", stock: 1 },
          { meta: { href: "product-2" }, code: "SKU-2", stock: 2 }
        ]
      },
      {
        meta: { size: 5 },
        rows: [
          { meta: { href: "product-3" }, code: "SKU-3", stock: 3 },
          { meta: { href: "product-4" }, code: "SKU-4", stock: 4 }
        ]
      },
      {
        meta: { size: 5 },
        rows: [{ meta: { href: "product-5" }, code: "SKU-5", stock: 5 }]
      }
    ]
    const fetch = jest
      .fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockImplementation(async () => successfulJson(pages.shift()))
    const throttle = jest.fn().mockResolvedValue(undefined)
    const client = new MoyskladClient(fetch, { throttle })
    const encryptedCredentials = encryptMoyskladCredentials({
      type: "token",
      token: "access-token"
    })
    const batches: MoyskladStockBatch[] = []

    for await (const batch of client.getStockBatches(encryptedCredentials, {
      pageSize: 2
    })) {
      batches.push(batch)
    }

    expect(batches.map((batch) => batch.rows.length)).toEqual([2, 2, 1])
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(throttle).toHaveBeenCalledTimes(3)
    expect(throttle).toHaveBeenNthCalledWith(1, 5)
    expect(throttle).toHaveBeenNthCalledWith(2, 5)
    expect(throttle).toHaveBeenNthCalledWith(3, 5)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.moysklad.ru/api/remap/1.2/report/stock/all?limit=2&offset=0",
      "https://api.moysklad.ru/api/remap/1.2/report/stock/all?limit=2&offset=2",
      "https://api.moysklad.ru/api/remap/1.2/report/stock/all?limit=2&offset=4"
    ])
  })

  it("loads product SKU identities in batches for the ambiguity preflight", async () => {
    const fetch = jest
      .fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValueOnce(
        successfulJson({
          meta: { size: 2 },
          rows: [{ id: "one", meta: { href: "product-1" }, code: "SKU-1" }]
        })
      )
      .mockResolvedValueOnce(
        successfulJson({
          meta: { size: 2 },
          rows: [{ id: "two", meta: { href: "product-2" }, code: "SKU-1" }]
        })
      )
    const throttle = jest.fn().mockResolvedValue(undefined)
    const client = new MoyskladClient(fetch, { throttle })
    const encryptedCredentials = encryptMoyskladCredentials({
      type: "token",
      token: "access-token"
    })
    const products: MoyskladProduct[] = []

    for await (const batch of client.getProductBatches(encryptedCredentials, {
      pageSize: 1
    })) {
      products.push(...batch.rows)
    }

    expect(products.map((product) => product.code)).toEqual(["SKU-1", "SKU-1"])
    expect(throttle).toHaveBeenCalledTimes(2)
    expect(throttle).toHaveBeenNthCalledWith(1, 1)
    expect(throttle).toHaveBeenNthCalledWith(2, 1)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.moysklad.ru/api/remap/1.2/entity/product?limit=1&offset=0",
      "https://api.moysklad.ru/api/remap/1.2/entity/product?limit=1&offset=1"
    ])
  })

  it("applies the weighted limiter to credential, entity, and stock-report requests", async () => {
    const fetch = jest
      .fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValueOnce(successfulJson({ id: "employee_1" }))
      .mockResolvedValueOnce(
        successfulJson({ rows: [{ id: "org_1", meta: { href: "organization-1" } }] })
      )
      .mockResolvedValueOnce(successfulJson({ meta: { size: 0 }, rows: [] }))
    const throttle = jest.fn().mockResolvedValue(undefined)
    const client = new MoyskladClient(fetch, { throttle })
    const credentials = { type: "token" as const, token: "access-token" }
    const encryptedCredentials = encryptMoyskladCredentials(credentials)

    await client.testCredentials(credentials)
    await client.findDefaultOrganization(encryptedCredentials)
    for await (const _batch of client.getStockBatches(encryptedCredentials)) {
      // Consume the single empty stock page.
    }

    expect(throttle.mock.calls).toEqual([[1], [1], [5]])
  })

  it("allows at most 45 weighted units in each rolling three-second window", async () => {
    let currentTime = 0
    const admissions: Array<{ at: number; weight: number }> = []
    const sleep = jest.fn(async (milliseconds: number) => {
      currentTime += milliseconds
    })
    const throttle = createMoyskladRateLimiter({
      now: () => currentTime,
      sleep
    })

    for (let request = 0; request < 10; request += 1) {
      await throttle(5)
      admissions.push({ at: currentTime, weight: 5 })
    }

    expect(admissions.slice(0, 9).map(({ at }) => at)).toEqual(Array(9).fill(0))
    expect(admissions[9].at).toBe(3_000)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(3_000)

    for (const admission of admissions) {
      const windowWeight = admissions
        .filter(({ at }) => at > admission.at - 3_000 && at <= admission.at)
        .reduce((total, entry) => total + entry.weight, 0)
      expect(windowWeight).toBeLessThanOrEqual(45)
    }
  })

  it("serializes concurrent admissions before spending the shared budget", async () => {
    let currentTime = 0
    const sleep = jest.fn(async (milliseconds: number) => {
      currentTime += milliseconds
    })
    const throttle = createMoyskladRateLimiter({
      now: () => currentTime,
      sleep
    })

    await Promise.all(Array.from({ length: 10 }, () => throttle(5)))

    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(3_000)
  })

  it("uses the API maximum of 1000 rows as the production page size", async () => {
    const fetch = jest
      .fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValue(successfulJson({ meta: { size: 0 }, rows: [] }))
    const throttle = jest.fn().mockResolvedValue(undefined)
    const client = new MoyskladClient(fetch, { throttle })
    const encryptedCredentials = encryptMoyskladCredentials({
      type: "token",
      token: "access-token"
    })

    for await (const _batch of client.getStockBatches(encryptedCredentials)) {
      // Consume the single empty page.
    }

    expect(fetch.mock.calls[0][0]).toBe("https://api.moysklad.ru/api/remap/1.2/report/stock/all?limit=1000&offset=0")
  })

  it("batches and throttles a full catalog larger than one production page", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      meta: { href: `product-${index}` },
      code: `SKU-${index}`,
      stock: index
    }))
    const fetch = jest
      .fn<Promise<MoyskladFetchResponse>, Parameters<MoyskladFetch>>()
      .mockResolvedValueOnce(successfulJson({ meta: { size: 1001 }, rows: firstPage }))
      .mockResolvedValueOnce(
        successfulJson({
          meta: { size: 1001 },
          rows: [{ meta: { href: "product-1000" }, code: "SKU-1000", stock: 1 }]
        })
      )
    const throttle = jest.fn().mockResolvedValue(undefined)
    const client = new MoyskladClient(fetch, { throttle })
    const encryptedCredentials = encryptMoyskladCredentials({
      type: "token",
      token: "access-token"
    })
    let rowCount = 0

    for await (const batch of client.getStockBatches(encryptedCredentials)) {
      rowCount += batch.rows.length
    }

    expect(rowCount).toBe(1001)
    expect(throttle).toHaveBeenCalledTimes(2)
    expect(throttle).toHaveBeenNthCalledWith(1, 5)
    expect(throttle).toHaveBeenNthCalledWith(2, 5)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.moysklad.ru/api/remap/1.2/report/stock/all?limit=1000&offset=0",
      "https://api.moysklad.ru/api/remap/1.2/report/stock/all?limit=1000&offset=1000"
    ])
  })

  it.each([0, 1001, 1.5])("rejects an invalid page size of %s", async (pageSize) => {
    const client = new MoyskladClient(jest.fn() as never)
    const encryptedCredentials = encryptMoyskladCredentials({
      type: "token",
      token: "access-token"
    })

    const consume = async () => {
      for await (const _batch of client.getStockBatches(encryptedCredentials, {
        pageSize
      })) {
        // The generator must fail before making a request.
      }
    }

    await expect(consume()).rejects.toThrow("between 1 and 1000")
  })
})
