jest.mock("@medusajs/core-flows", () => ({
  createInventoryLevelsWorkflow: jest.fn(),
  updateInventoryLevelsWorkflow: jest.fn(),
}))

import {
  createInventoryLevelsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/core-flows"

import moyskladStockSyncJob, {
  config,
  runMoyskladStockSyncJob,
  syncMoyskladStock,
} from "../moysklad-stock-sync"
import { MoyskladApiError } from "../../modules/moysklad-integration/client"

const updateInventoryLevelsWorkflowMock =
  updateInventoryLevelsWorkflow as unknown as jest.Mock
const createInventoryLevelsWorkflowMock =
  createInventoryLevelsWorkflow as unknown as jest.Mock

function asyncBatches(
  batches: Array<{
    rows: Array<{ code?: string; article?: string; stock: number }>
  }>
) {
  return {
    async *getProductBatches() {
      const products = batches.flatMap((batch, batchIndex) =>
        batch.rows
          .filter((row) => row.code)
          .map((row, rowIndex) => ({
            id: `ms_${batchIndex}_${rowIndex}`,
            code: row.code,
            article: row.article,
            meta: {
              href: `https://api.moysklad.test/product/${row.code}`,
            },
          }))
      )
      yield { rows: products } as never
    },
    async *getStockBatches() {
      for (const [batchIndex, batch] of batches.entries()) {
        yield {
          rows: batch.rows.map((row, rowIndex) => ({
            meta: {
              href: `https://api.moysklad.test/product/${row.code ?? `${batchIndex}-${rowIndex}`}`,
            },
            ...row,
          })),
        } as never
      }
    },
  }
}

function buildVariant(index: number) {
  return {
    id: `variant_${index}`,
    sku: `SKU-${index}`,
    inventory_items: [
      {
        inventory_item_id: `iitem_${index}`,
        inventory: {
          location_levels: [
            { id: `ilevel_${index}`, location_id: "loc_1" },
          ],
        },
      },
    ],
  }
}

function buildContainer(options: {
  active?: boolean
  credentials?: string | null
  variants?: Record<string, unknown>[]
  orders?: Record<string, any>[]
} = {}) {
  const logger = { info: jest.fn(), error: jest.fn() }
  const moyskladService = {
    getConnectionConfig: jest.fn().mockResolvedValue(
      options.active === false
        ? { is_active: false, encrypted_credentials: "encrypted" }
        : {
            is_active: true,
            encrypted_credentials:
              options.credentials === undefined
                ? "encrypted"
                : options.credentials,
          }
    ),
    recordStockSyncSuccess: jest.fn().mockResolvedValue({}),
    recordStockSyncFailure: jest.fn().mockResolvedValue({}),
  }
  const query = {
    graph: jest.fn(async ({
      entity,
      pagination,
    }: {
      entity: string
      pagination?: { take?: number; skip?: number }
    }) => {
      if (entity === "store") {
        return { data: [{ id: "store_1", default_location_id: "loc_1" }] }
      }

      if (entity === "order") {
        const orders = options.orders ?? []
        const skip = pagination?.skip ?? 0
        const take = pagination?.take ?? orders.length

        return { data: orders.slice(skip, skip + take) }
      }

      const variants = options.variants ?? [buildVariant(1), buildVariant(2)]
      const skip = pagination?.skip ?? 0
      const take = pagination?.take ?? variants.length

      return { data: variants.slice(skip, skip + take) }
    }),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "logger") return logger
      if (key === "query") return query
      return moyskladService
    }),
  }

  return { container, logger, moyskladService, query }
}

describe("moysklad stock sync job", () => {
  beforeEach(() => {
    createInventoryLevelsWorkflowMock.mockReset()
    updateInventoryLevelsWorkflowMock.mockReset()
  })

  it("is scheduled every fifteen minutes", () => {
    expect(config).toEqual({
      name: "moysklad-stock-sync",
      schedule: "*/15 * * * *",
    })
  })

  it("does not start a second stock-sync cycle while the first is running", async () => {
    const { container, logger } = buildContainer()
    let releaseFirst!: () => void
    let reportFirstStarted!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>((resolve) => {
      reportFirstStarted = resolve
    })
    const firstClient = {
      async *getProductBatches() {
        reportFirstStarted()
        await firstGate
        yield { rows: [] } as never
      },
      async *getStockBatches() {
        yield { rows: [] } as never
      },
    }
    const secondStarted = jest.fn()
    const secondClient = {
      async *getProductBatches() {
        secondStarted()
        yield { rows: [] } as never
      },
      async *getStockBatches() {
        yield { rows: [] } as never
      },
    }

    const firstRun = runMoyskladStockSyncJob(
      container as never,
      firstClient as never
    )
    await firstStarted

    await expect(
      runMoyskladStockSyncJob(container as never, secondClient as never)
    ).resolves.toBe(false)
    expect(secondStarted).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      "MoySklad stock sync skipped: previous cycle is still running."
    )

    releaseFirst()
    await firstRun
  })

  it("does nothing when the integration is disabled", async () => {
    const { container, query } = buildContainer({ active: false })
    const client = asyncBatches([{ rows: [{ code: "SKU-1", stock: 5 }] }])

    await syncMoyskladStock(container as never, client as never)

    expect(query.graph).not.toHaveBeenCalled()
    expect(updateInventoryLevelsWorkflowMock).not.toHaveBeenCalled()
  })

  it("does nothing when an active integration has no stored credentials", async () => {
    const { container, query } = buildContainer({ credentials: null })
    const client = asyncBatches([{ rows: [{ code: "SKU-1", stock: 5 }] }])

    await syncMoyskladStock(container as never, client as never)

    expect(query.graph).not.toHaveBeenCalled()
    expect(updateInventoryLevelsWorkflowMock).not.toHaveBeenCalled()
  })

  it("loads every page of Medusa variants before applying stock", async () => {
    const variants = Array.from({ length: 201 }, (_, index) =>
      buildVariant(index + 1)
    )
    const { container, query } = buildContainer({ variants })
    const run = jest.fn().mockResolvedValue({ result: [] })
    updateInventoryLevelsWorkflowMock.mockReturnValue({ run })
    const client = asyncBatches([
      { rows: [{ code: "SKU-201", stock: 9 }] },
    ])

    await syncMoyskladStock(container as never, client as never)

    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product_variant",
        pagination: expect.objectContaining({ take: 200, skip: 200 }),
      })
    )
    expect(run).toHaveBeenCalledWith({
      input: {
        updates: [
          expect.objectContaining({
            inventory_item_id: "iitem_201",
            stocked_quantity: 9,
          }),
        ],
      },
    })
  })

  it("creates a standard inventory level when the default location has none", async () => {
    const variant = buildVariant(1)
    variant.inventory_items[0].inventory.location_levels = []
    const { container } = buildContainer({ variants: [variant] })
    const run = jest.fn().mockResolvedValue({ result: [] })
    createInventoryLevelsWorkflowMock.mockReturnValue({ run })
    const client = asyncBatches([
      { rows: [{ code: "SKU-1", stock: 6 }] },
    ])

    await syncMoyskladStock(container as never, client as never)

    expect(run).toHaveBeenCalledWith({
      input: {
        inventory_levels: [
          {
            inventory_item_id: "iitem_1",
            location_id: "loc_1",
            stocked_quantity: 6,
          },
        ],
      },
    })
    expect(updateInventoryLevelsWorkflowMock).not.toHaveBeenCalled()
  })

  it("updates each inventory level through an independent standard workflow", async () => {
    const { container } = buildContainer()
    const run = jest.fn().mockResolvedValue({ result: [] })
    updateInventoryLevelsWorkflowMock.mockReturnValue({ run })
    const client = asyncBatches([
      { rows: [{ code: "SKU-1", stock: 7 }] },
      { rows: [{ code: "SKU-2", stock: 11 }] },
    ])

    await syncMoyskladStock(container as never, client as never)

    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenNthCalledWith(1, {
      input: {
        updates: [
          {
            id: "ilevel_1",
            inventory_item_id: "iitem_1",
            location_id: "loc_1",
            stocked_quantity: 7,
          },
        ],
      },
    })
    expect(run).toHaveBeenNthCalledWith(2, {
      input: {
        updates: [
          {
            id: "ilevel_2",
            inventory_item_id: "iitem_2",
            location_id: "loc_1",
            stocked_quantity: 11,
          },
        ],
      },
    })
  })

  it("matches stock by code and ignores a different or missing article", async () => {
    const { container } = buildContainer({ variants: [buildVariant(1)] })
    const run = jest.fn().mockResolvedValue({ result: [] })
    updateInventoryLevelsWorkflowMock.mockReturnValue({ run })

    await syncMoyskladStock(
      container as never,
      asyncBatches([
        {
          rows: [
            { code: "SKU-1", article: "LEGACY-ARTICLE", stock: 9 },
          ],
        },
      ]) as never
    )

    expect(run).toHaveBeenCalledWith({
      input: {
        updates: [expect.objectContaining({ stocked_quantity: 9 })],
      },
    })
  })

  it("does not fall back to article when the product code is absent", async () => {
    const { container } = buildContainer({ variants: [buildVariant(1)] })
    const run = jest.fn().mockResolvedValue({ result: [] })
    updateInventoryLevelsWorkflowMock.mockReturnValue({ run })

    await syncMoyskladStock(
      container as never,
      asyncBatches([{ rows: [{ article: "SKU-1", stock: 9 }] }]) as never
    )

    expect(run).not.toHaveBeenCalled()
  })

  it("keeps prior updates, continues later products, and fails the cycle when one update fails", async () => {
    const { container, logger } = buildContainer({
      variants: [buildVariant(1), buildVariant(2), buildVariant(3)],
    })
    const run = jest
      .fn()
      .mockResolvedValueOnce({ result: [] })
      .mockRejectedValueOnce(new Error("inventory unavailable"))
      .mockResolvedValueOnce({ result: [] })
    updateInventoryLevelsWorkflowMock.mockReturnValue({ run })
    const client = asyncBatches([
      {
        rows: [
          { code: "SKU-1", stock: 1 },
          { code: "SKU-2", stock: 2 },
          { code: "SKU-3", stock: 3 },
        ],
      },
    ])

    await expect(
      syncMoyskladStock(container as never, client as never)
    ).rejects.toThrow("inventory unavailable")

    expect(run).toHaveBeenCalledTimes(3)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("inventory unavailable")
    )
  })

  it("records an inventory application error as a failed cycle instead of success", async () => {
    const { container, moyskladService } = buildContainer({
      variants: [buildVariant(1)],
    })
    const run = jest.fn().mockRejectedValue(new Error("inventory unavailable"))
    updateInventoryLevelsWorkflowMock.mockReturnValue({ run })

    await runMoyskladStockSyncJob(
      container as never,
      asyncBatches([{ rows: [{ code: "SKU-1", stock: 1 }] }]) as never
    )

    expect(moyskladService.recordStockSyncFailure).toHaveBeenCalledWith(
      expect.stringContaining("inventory unavailable")
    )
    expect(moyskladService.recordStockSyncSuccess).not.toHaveBeenCalled()
  })

  it("subtracts only non-canceled site orders from the fixed 48-hour window", async () => {
    const now = new Date("2026-08-20T12:00:00.000Z")
    const recent = new Date(now.getTime() - 47 * 60 * 60 * 1000)
    const { container } = buildContainer({
      variants: [buildVariant(1)],
      orders: [
        {
          id: "order_site",
          status: "pending",
          created_at: recent,
          metadata: { checkout_contact_name: "Иван" },
          items: [{ variant_sku: "SKU-1", quantity: 3 }],
        },
        {
          id: "order_canceled",
          status: "canceled",
          created_at: recent,
          metadata: { checkout_contact_name: "Иван" },
          items: [{ variant_sku: "SKU-1", quantity: 4 }],
        },
        {
          id: "order_site_second",
          status: "pending",
          created_at: recent,
          metadata: { checkout_contact_name: "Мария" },
          items: [
            { variant_sku: "SKU-1", quantity: 1 },
            { variant_sku: "SKU-1", quantity: 2 },
          ],
        },
        {
          id: "order_old",
          status: "pending",
          created_at: new Date(now.getTime() - 49 * 60 * 60 * 1000),
          metadata: { checkout_contact_name: "Иван" },
          items: [{ variant_sku: "SKU-1", quantity: 5 }],
        },
        {
          id: "order_admin",
          status: "pending",
          created_at: recent,
          metadata: {},
          items: [{ variant_sku: "SKU-1", quantity: 6 }],
        },
      ],
    })
    const run = jest.fn().mockResolvedValue({ result: [] })
    updateInventoryLevelsWorkflowMock.mockReturnValue({ run })

    await syncMoyskladStock(
      container as never,
      asyncBatches([{ rows: [{ code: "SKU-1", stock: 10 }] }]) as never,
      now
    )

    expect(run).toHaveBeenCalledWith({
      input: {
        updates: [expect.objectContaining({ stocked_quantity: 4 })],
      },
    })
    expect((container.resolve("query") as any).graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "order",
        filters: {
          status: { $ne: "canceled" },
          created_at: {
            $gte: new Date("2026-08-18T12:00:00.000Z"),
            $lte: now,
          },
        },
      })
    )
  })

  it("skips absent and ambiguous SKU matches without blocking unambiguous stock", async () => {
    const duplicateA = buildVariant(1)
    const duplicateB = buildVariant(5)
    duplicateB.sku = "SKU-1"
    const { container, logger } = buildContainer({
      variants: [
        duplicateA,
        buildVariant(2),
        buildVariant(3),
        buildVariant(4),
        duplicateB,
      ],
    })
    const run = jest.fn().mockResolvedValue({ result: [] })
    updateInventoryLevelsWorkflowMock.mockReturnValue({ run })
    const client = {
      async *getProductBatches() {
        yield {
          rows: [
            { id: "one", meta: { href: "ms/one" }, code: "SKU-1" },
            { id: "two-a", meta: { href: "ms/two-a" }, code: "SKU-2" },
            { id: "two-b", meta: { href: "ms/two-b" }, code: "SKU-2" },
            { id: "four", meta: { href: "ms/four" }, code: "SKU-4" },
          ],
        } as never
      },
      async *getStockBatches() {
        yield {
          rows: [
            { meta: { href: "ms/one" }, code: "SKU-1", stock: 5 },
            { meta: { href: "ms/two-a" }, code: "SKU-2", stock: 6 },
            { meta: { href: "ms/two-b" }, code: "SKU-2", stock: 7 },
            { meta: { href: "ms/four" }, code: "SKU-4", stock: 8 },
          ],
        } as never
      },
    }

    const result = await syncMoyskladStock(container as never, client as never)

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith({
      input: {
        updates: [expect.objectContaining({ inventory_item_id: "iitem_4" })],
      },
    })
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("SKU SKU-1: нет однозначного соответствия")
    )
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("SKU SKU-2: нет однозначного соответствия")
    )
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("SKU SKU-3: нет однозначного соответствия")
    )
    expect(result).toEqual({
      unmatched: expect.arrayContaining([
        expect.objectContaining({
          source: "medusa_variant",
          source_id: "variant_1",
          reason: "ambiguous_medusa_sku",
        }),
        expect.objectContaining({
          source: "moysklad_product",
          source_id: "two-a",
          reason: "ambiguous_moysklad_code",
        }),
        expect.objectContaining({
          source: "medusa_variant",
          source_id: "variant_3",
          reason: "missing_moysklad_match",
        }),
      ]),
    })
  })

  it("reports a stock row without code without falling back to article", async () => {
    const { container } = buildContainer({ variants: [buildVariant(1)] })
    const client = {
      async *getProductBatches() {
        yield {
          rows: [
            {
              id: "ms_without_code",
              name: "Краска без кода",
              article: "SKU-1",
              meta: { href: "ms/without-code" },
            },
          ],
        } as never
      },
      async *getStockBatches() {
        yield {
          rows: [
            {
              meta: { href: "ms/without-code" },
              name: "Краска без кода",
              article: "SKU-1",
              stock: 3,
            },
          ],
        } as never
      },
    }

    const result = await syncMoyskladStock(
      container as never,
      client as never
    )

    expect(result).toEqual({
      unmatched: expect.arrayContaining([
        {
          source: "moysklad_product",
          source_id: "ms_without_code",
          code: null,
          sku: null,
          name: "Краска без кода",
          reason: "missing_moysklad_code",
        },
      ]),
    })
  })

  it("keeps an applied stock batch, records a later report failure, and does not touch order sync statuses", async () => {
    const { container, logger, moyskladService } = buildContainer()
    const run = jest.fn().mockResolvedValue({ result: [] })
    updateInventoryLevelsWorkflowMock.mockReturnValue({ run })
    const failingClient = {
      async *getProductBatches() {
        yield {
          rows: [
            { id: "one", meta: { href: "ms/one" }, code: "SKU-1" },
            { id: "two", meta: { href: "ms/two" }, code: "SKU-2" },
          ],
        } as never
      },
      async *getStockBatches() {
        yield {
          rows: [{ meta: { href: "ms/one" }, code: "SKU-1", stock: 4 }],
        } as never
        throw new Error("MoySklad unavailable")
      },
    }

    await runMoyskladStockSyncJob(container as never, failingClient as never)

    expect(run).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("MoySklad stock sync job failed")
    )
    expect(moyskladService.recordStockSyncFailure).toHaveBeenCalledWith(
      "MoySklad unavailable"
    )
    expect(moyskladService.recordStockSyncSuccess).not.toHaveBeenCalled()
    expect(moyskladService).not.toHaveProperty("recordOrderSyncAttempt")
  })

  it("records an exhausted rate-limit operation as a failed sync cycle", async () => {
    const { container, moyskladService } = buildContainer()
    const rateLimitedClient = {
      async *getProductBatches() {
        throw new MoyskladApiError("Лимит всё ещё превышен", 429)
      },
      async *getStockBatches() {
        yield { rows: [] } as never
      },
    }

    await runMoyskladStockSyncJob(container as never, rateLimitedClient as never)

    expect(moyskladService.recordStockSyncFailure).toHaveBeenCalledWith(
      "Лимит всё ещё превышен"
    )
    expect(moyskladService.recordStockSyncSuccess).not.toHaveBeenCalled()
  })

  it("точка входа джобы игнорирует второй аргумент Medusa и создаёт клиент сама", async () => {
    // Medusa вызывает handler(container, context). Раньше сигнатура джобы была
    // (container, client = new MoyskladClient()), поэтому context попадал в
    // client и синхронизация падала на getProductBatches is not a function.
    const container = {
      resolve: jest.fn(() => {
        throw new Error("resolve не должен вызываться: клиент обязан создаваться сам")
      }),
    }

    const medusaContext = { some: "context" }

    // Вызов с двумя аргументами намеренный: так джобу вызывает сам Medusa.
    // Сигнатура принимает один параметр, поэтому приводим тип явно.
    const invokeAsMedusa = moyskladStockSyncJob as unknown as (
      container: unknown,
      context: unknown
    ) => Promise<void>

    await expect(
      invokeAsMedusa(container, medusaContext)
    ).rejects.toThrow("resolve не должен вызываться")

    expect(moyskladStockSyncJob.length).toBe(1)
  })
})
