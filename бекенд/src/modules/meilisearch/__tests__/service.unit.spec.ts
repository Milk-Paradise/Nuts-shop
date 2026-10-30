import MeilisearchModuleService, {
  brandNamesFromFacet,
  catalogIndexSettings,
  errorCode,
} from "../service"

describe("catalog index settings", () => {
  it("indexes keywords as a separate attribute with priority no lower than title", () => {
    const keywordPriority = catalogIndexSettings.searchableAttributes.indexOf(
      "search_keywords",
    )
    const titlePriority = catalogIndexSettings.searchableAttributes.indexOf("title")

    expect(keywordPriority).toBeGreaterThanOrEqual(0)
    expect(keywordPriority).toBeLessThanOrEqual(titlePriority)
  })
})

describe("errorCode", () => {
  it("reads a top-level error code", () => {
    expect(errorCode({ code: "index_not_found" })).toBe("index_not_found")
  })

  it("falls back to the meilisearch client's cause.code", () => {
    // The meilisearch JS client wraps the API response under `cause`,
    // not a top-level `code` — this is what a fresh/empty index throws.
    const error = new Error("Index `products` not found.")
    ;(error as { cause?: unknown }).cause = { code: "index_not_found" }

    expect(errorCode(error)).toBe("index_not_found")
  })

  it("returns undefined for unrelated errors", () => {
    expect(errorCode(new Error("boom"))).toBeUndefined()
    expect(errorCode(null)).toBeUndefined()
    expect(errorCode("boom")).toBeUndefined()
  })
})

describe("brandNamesFromFacet", () => {
  it("returns a stable unique non-empty brand list from the catalog facet", () => {
    expect(brandNamesFromFacet({ " Mobihel ": 3, mobihel: 2, "": 2, Sikkens: 1 })).toEqual(["Mobihel", "Sikkens"])
  })

  it("treats a missing facet as an empty catalog", () => {
    expect(brandNamesFromFacet()).toEqual([])
  })
})

describe("searchCatalogDocuments", () => {
  function serviceWithClient(client: unknown) {
    class TestService extends MeilisearchModuleService {
      protected async client() {
        return client as never
      }
    }

    return new TestService(null, { host: "http://localhost:7700" })
  }

  it("applies index settings and retries once when a field is not sortable yet", async () => {
    const notSortable = Object.assign(new Error("Attribute `price` is not sortable."), {
      cause: { code: "invalid_search_sort" },
    })
    const search = jest
      .fn()
      .mockRejectedValueOnce(notSortable)
      .mockResolvedValueOnce({ hits: [], totalHits: 0, page: 1, hitsPerPage: 24, totalPages: 0, processingTimeMs: 1, query: "" })
    const updateSettings = jest.fn().mockReturnValue({ waitTask: jest.fn().mockResolvedValue(undefined) })
    const client = {
      getIndex: jest.fn().mockResolvedValue({}),
      index: jest.fn().mockReturnValue({ search, updateSettings }),
    }

    const result = await serviceWithClient(client).searchCatalogDocuments({
      sort: ["price:asc"],
      page: 1,
      hitsPerPage: 24,
    })

    expect(updateSettings).toHaveBeenCalledWith(catalogIndexSettings)
    expect(search).toHaveBeenCalledTimes(2)
    expect(result.totalHits).toBe(0)
  })

  it.each(["invalid_search_facets", "invalid_search_filter"])("repairs %s settings and retries", async (code) => {
    const search = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error(code), { code }))
      .mockResolvedValueOnce({ hits: [], estimatedTotalHits: 0, processingTimeMs: 2, query: "paint" })
    const waitTask = jest.fn().mockResolvedValue(undefined)
    const client = {
      getIndex: jest.fn().mockResolvedValue({}),
      index: jest.fn().mockReturnValue({ search, updateSettings: jest.fn().mockReturnValue({ waitTask }) }),
    }
    await expect(serviceWithClient(client).searchCatalogDocuments({ query: "paint", filter: ["brand=x"], facets: ["brand"], page: 2, hitsPerPage: 10 })).resolves.toMatchObject({ totalHits: 0, page: 2, totalPages: 0 })
    expect(search).toHaveBeenCalledTimes(2)
  })

  it("returns an empty catalog when the index does not exist", async () => {
    const search = jest.fn().mockRejectedValue(Object.assign(new Error("missing"), { cause: { code: "index_not_found" } }))
    const client = { index: jest.fn().mockReturnValue({ search }) }
    await expect(serviceWithClient(client).searchCatalogDocuments({ query: "x", page: 3, hitsPerPage: 5 })).resolves.toEqual({
      hits: [], totalHits: 0, page: 3, hitsPerPage: 5, totalPages: 0, processingTimeMs: 0, query: "x",
    })
  })

  it("maps result fallbacks and optional search parameters", async () => {
    const search = jest.fn().mockResolvedValue({
      hits: [{ id: "1" }, { id: "2" }], estimatedTotalHits: 12,
      processingTimeMs: 4, query: "x", facetDistribution: { brand: { A: 1 } },
    })
    const client = { index: jest.fn().mockReturnValue({ search }) }
    const result = await serviceWithClient(client).searchCatalogDocuments({ query: "x", filter: [], sort: [], facets: [], page: 2, hitsPerPage: 5 })
    expect(result).toMatchObject({ totalHits: 12, page: 2, hitsPerPage: 5, totalPages: 3, facetDistribution: { brand: { A: 1 } } })
    expect(search).toHaveBeenCalledWith("x", expect.objectContaining({ filter: undefined, sort: undefined, facets: undefined }))
  })

  it("propagates unrelated search failures", async () => {
    const search = jest.fn().mockRejectedValue(new Error("offline"))
    const client = { index: jest.fn().mockReturnValue({ search }) }
    await expect(serviceWithClient(client).searchCatalogDocuments({ page: 1, hitsPerPage: 10 })).rejects.toThrow("offline")
  })

  it("configures a missing index and updates settings", async () => {
    const waitTask = jest.fn().mockResolvedValue(undefined)
    const updateSettings = jest.fn().mockReturnValue({ waitTask })
    const createIndex = jest.fn().mockReturnValue({ waitTask })
    const client = {
      getIndex: jest.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "index_not_found" })),
      createIndex,
      index: jest.fn().mockReturnValue({ updateSettings }),
    }
    await serviceWithClient(client).configureCatalogIndex()
    expect(createIndex).toHaveBeenCalledWith("products", { primaryKey: "id" })
    expect(updateSettings).toHaveBeenCalledWith(catalogIndexSettings)
  })

  it("propagates configuration errors other than a missing index", async () => {
    const client = { getIndex: jest.fn().mockRejectedValue(new Error("offline")) }
    await expect(serviceWithClient(client).configureCatalogIndex()).rejects.toThrow("offline")
  })

  // Переиндексация здесь не проверяется: resetCatalogIndex подменяет индекс
  // целиком и покрыт отдельным тестом ниже.
  it("upserts, deletes and counts documents", async () => {
    const waitTask = jest.fn().mockResolvedValue(undefined)
    const index = {
      addDocuments: jest.fn().mockReturnValue({ waitTask }),
      deleteDocuments: jest.fn().mockReturnValue({ waitTask }),
      updateSettings: jest.fn().mockReturnValue({ waitTask }),
      getStats: jest.fn().mockResolvedValue({ numberOfDocuments: 7 }),
    }
    const client = { getIndex: jest.fn().mockResolvedValue({}), index: jest.fn().mockReturnValue(index) }
    const service = serviceWithClient(client)
    await service.upsertCatalogDocuments([])
    await service.deleteCatalogDocuments([])
    expect(index.addDocuments).not.toHaveBeenCalled()
    await service.upsertCatalogDocuments([{ id: "1" }] as any)
    await service.deleteCatalogDocuments(["1"])
    expect(index.addDocuments).toHaveBeenCalled()
    expect(index.deleteDocuments).toHaveBeenCalledWith(["1"])
    await expect(service.countCatalogDocuments()).resolves.toBe(7)
  })

  it("checks matching documents and brands with missing-index fallbacks", async () => {
    const search = jest.fn()
      .mockResolvedValueOnce({ totalHits: 1 })
      .mockResolvedValueOnce({ facetDistribution: { brand: { " Zed ": 1, zed: 1 } } })
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "index_not_found" }))
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { cause: { code: "index_not_found" } }))
    const client = { index: jest.fn().mockReturnValue({ search }) }
    const service = serviceWithClient(client)
    await expect(service.hasCatalogDocumentsMatching("brand=Zed")).resolves.toBe(true)
    await expect(service.listCatalogBrands()).resolves.toEqual(["Zed"])
    await expect(service.hasCatalogDocumentsMatching("x")).resolves.toBe(false)
    await expect(service.listCatalogBrands()).resolves.toEqual([])
  })
})

describe("resetCatalogIndex", () => {
  function serviceWithClient(client: unknown) {
    class TestService extends MeilisearchModuleService {
      protected async client() {
        return client as never
      }
    }

    return new TestService(null, { host: "http://localhost:7700" })
  }

  it("atomically swaps a populated temporary index without clearing the live index", async () => {
    const calls: string[] = []
    const task = (call: string) => ({
      waitTask: jest.fn().mockImplementation(async () => {
        calls.push(call)
      }),
    })
    const deleteAllDocuments = jest.fn().mockReturnValue(task("clear"))
    const client = {
      getIndex: jest.fn().mockResolvedValue({}),
      createIndex: jest.fn((uid: string) => task(`create:${uid}`)),
      deleteIndex: jest.fn((uid: string) => task(`delete:${uid}`)),
      index: jest.fn((uid: string) => ({
        updateSettings: jest.fn().mockReturnValue(task(`settings:${uid}`)),
        addDocuments: jest.fn().mockReturnValue(task(`documents:${uid}`)),
        deleteAllDocuments,
      })),
      swapIndexes: jest.fn(
        ([{ indexes }]: [{ indexes: [string, string] }]) =>
          task(`swap:${indexes.join(":")}`)
      ),
    }
    const document = {
      id: "prod_1",
      title: "Грунт",
    } as any

    await serviceWithClient(client).resetCatalogIndex([document])

    const temporaryIndex = client.createIndex.mock.calls[0][0]

    expect(temporaryIndex).toMatch(/^products_reindex_/)
    expect(deleteAllDocuments).not.toHaveBeenCalled()
    expect(calls).toEqual([
      "settings:products",
      `create:${temporaryIndex}`,
      `settings:${temporaryIndex}`,
      `documents:${temporaryIndex}`,
      `swap:products:${temporaryIndex}`,
      `delete:${temporaryIndex}`,
    ])
  })

  it("honors indexPrefix so parallel e2e runs don't reset each other's index", async () => {
    // Изоляция параллельных e2e-прогонов держится на MEILISEARCH_INDEX_PREFIX
    // lifecycle test environment. Если reset/swap обратится к "products" в
    // обход this.catalogIndex(), один прогон переиндексирует чужой индекс.
    const calls: string[] = []
    const task = (call: string) => ({
      waitTask: jest.fn().mockImplementation(async () => {
        calls.push(call)
      }),
    })
    const client = {
      getIndex: jest.fn().mockResolvedValue({}),
      createIndex: jest.fn((uid: string) => task(`create:${uid}`)),
      deleteIndex: jest.fn((uid: string) => task(`delete:${uid}`)),
      index: jest.fn((uid: string) => ({
        updateSettings: jest.fn().mockReturnValue(task(`settings:${uid}`)),
        addDocuments: jest.fn().mockReturnValue(task(`documents:${uid}`)),
        deleteAllDocuments: jest.fn().mockReturnValue(task(`clear:${uid}`)),
      })),
      swapIndexes: jest.fn(
        ([{ indexes }]: [{ indexes: [string, string] }]) =>
          task(`swap:${indexes.join(":")}`)
      ),
    }

    class TestService extends MeilisearchModuleService {
      protected async client() {
        return client as never
      }
    }

    await new TestService(null, {
      host: "http://localhost:7700",
      indexPrefix: "e2e_run1_",
    }).resetCatalogIndex([])

    const temporaryIndex = client.createIndex.mock.calls[0][0]

    expect(temporaryIndex).toMatch(/^e2e_run1_products_reindex_/)
    expect(calls).toContain(`swap:e2e_run1_products:${temporaryIndex}`)
  })

  it("cleans up the temporary index if populating it fails", async () => {
    const indexingError = new Error("indexing failed")
    const task = (result?: unknown) => ({
      waitTask: jest.fn().mockImplementation(async () => {
        if (result instanceof Error) {
          throw result
        }
      }),
    })
    const client = {
      getIndex: jest.fn().mockResolvedValue({}),
      createIndex: jest.fn().mockReturnValue(task()),
      deleteIndex: jest.fn().mockReturnValue(task()),
      index: jest.fn((uid: string) => ({
        updateSettings: jest.fn().mockReturnValue(task()),
        addDocuments: jest
          .fn()
          .mockReturnValue(task(uid === "products" ? undefined : indexingError)),
      })),
      swapIndexes: jest.fn().mockReturnValue(task()),
    }
    const service = serviceWithClient(client)

    await expect(
      service.resetCatalogIndex([{ id: "prod_1", title: "Грунт" } as any])
    ).rejects.toThrow(indexingError)

    const temporaryIndex = client.createIndex.mock.calls[0][0]

    expect(client.deleteIndex).toHaveBeenCalledWith(temporaryIndex)
    expect(client.swapIndexes).not.toHaveBeenCalled()
  })

  it("serializes parallel resets and isolates their temporary indexes", async () => {
    let releaseFirstDocuments!: () => void
    let markFirstDocumentsStarted!: () => void
    const firstDocumentsBlocked = new Promise<void>((resolve) => {
      releaseFirstDocuments = resolve
    })
    const firstDocumentsStarted = new Promise<void>((resolve) => {
      markFirstDocumentsStarted = resolve
    })
    let documentTask = 0
    const completedTask = () => ({
      waitTask: jest.fn().mockResolvedValue(undefined),
    })
    const client = {
      getIndex: jest.fn().mockResolvedValue({}),
      createIndex: jest.fn().mockReturnValue(completedTask()),
      deleteIndex: jest.fn().mockReturnValue(completedTask()),
      index: jest.fn().mockImplementation(() => ({
        updateSettings: jest.fn().mockReturnValue(completedTask()),
        addDocuments: jest.fn().mockImplementation(() => {
          const currentTask = documentTask++

          return {
            waitTask: jest.fn().mockImplementation(async () => {
              if (currentTask === 0) {
                markFirstDocumentsStarted()
                await firstDocumentsBlocked
              }
            }),
          }
        }),
      })),
      swapIndexes: jest.fn().mockReturnValue(completedTask()),
    }
    const service = serviceWithClient(client)
    const firstReset = service.resetCatalogIndex([
      { id: "prod_1", title: "Грунт" } as any,
    ])

    await firstDocumentsStarted

    const secondReset = service.resetCatalogIndex([
      { id: "prod_2", title: "Эмаль" } as any,
    ])

    await Promise.resolve()
    expect(client.createIndex).toHaveBeenCalledTimes(1)

    releaseFirstDocuments()
    await Promise.all([firstReset, secondReset])

    const temporaryIndexes = client.createIndex.mock.calls.map(([uid]) => uid)

    expect(new Set(temporaryIndexes).size).toBe(2)
    expect(client.swapIndexes.mock.calls).toEqual(
      temporaryIndexes.map((uid) => [[{ indexes: ["products", uid] }]])
    )
    expect(client.deleteIndex.mock.calls).toEqual(
      temporaryIndexes.map((uid) => [uid])
    )
  })
})
