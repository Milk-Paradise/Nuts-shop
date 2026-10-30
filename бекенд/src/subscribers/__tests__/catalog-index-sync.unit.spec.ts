import {
  InventoryEvents,
  ProductVariantWorkflowEvents,
  ProductWorkflowEvents,
} from "@medusajs/framework/utils"

import syncCatalogIndex, { config } from "../catalog-index-sync"
import {
  productIdsByInventoryEntityIds,
  productIdsByVariantIds,
  reindexCatalogDocuments,
  syncCatalogProductsByIds,
} from "../../modules/meilisearch/sync"

jest.mock("../../modules/meilisearch/sync", () => ({
  productIdsByInventoryEntityIds: jest.fn(),
  productIdsByVariantIds: jest.fn(),
  reindexCatalogDocuments: jest.fn(),
  syncCatalogProductsByIds: jest.fn(),
}))

const mockedProductIdsByInventoryEntityIds = jest.mocked(
  productIdsByInventoryEntityIds
)
const mockedProductIdsByVariantIds = jest.mocked(productIdsByVariantIds)
const mockedReindexCatalogDocuments = jest.mocked(reindexCatalogDocuments)
const mockedSyncCatalogProductsByIds = jest.mocked(syncCatalogProductsByIds)

function container() {
  const logger = {
    info: jest.fn(),
    error: jest.fn(),
  }

  return {
    logger,
    container: {
      resolve(key: string) {
        if (key === "logger") {
          return logger
        }

        throw new Error(`Unexpected container key: ${key}`)
      },
    },
  }
}

describe("catalog index sync subscriber", () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedSyncCatalogProductsByIds.mockResolvedValue({
      indexed: 1,
      deleted: 0,
      skipped: 0,
    })
    mockedProductIdsByInventoryEntityIds.mockResolvedValue(["prod_1"])
    mockedProductIdsByVariantIds.mockResolvedValue(["prod_1"])
    mockedReindexCatalogDocuments.mockResolvedValue({
      indexed: 5,
      deleted: 0,
      skipped: 1,
    })
  })

  it("subscribes to product, variant, and inventory events with a stable id", () => {
    expect(config.context?.subscriberId).toBe("catalog-index-sync")
    expect(config.event).toEqual(
      expect.arrayContaining([
        ProductWorkflowEvents.UPDATED,
        ProductWorkflowEvents.DELETED,
        ProductVariantWorkflowEvents.UPDATED,
        ProductVariantWorkflowEvents.DELETED,
        InventoryEvents.INVENTORY_LEVEL_UPDATED,
        InventoryEvents.RESERVATION_ITEM_DELETED,
      ])
    )
  })

  it("syncs changed product ids directly", async () => {
    const scope = container()

    await syncCatalogIndex({
      event: {
        name: ProductWorkflowEvents.UPDATED,
        data: { id: "prod_1" },
      },
      container: scope.container as any,
      pluginOptions: {},
    })

    expect(mockedSyncCatalogProductsByIds).toHaveBeenCalledWith(
      scope.container,
      ["prod_1"]
    )
    expect(mockedReindexCatalogDocuments).not.toHaveBeenCalled()
  })

  it("resolves product ids for changed variants", async () => {
    const scope = container()

    await syncCatalogIndex({
      event: {
        name: ProductVariantWorkflowEvents.UPDATED,
        data: { id: "variant_1" },
      },
      container: scope.container as any,
      pluginOptions: {},
    })

    expect(mockedProductIdsByVariantIds).toHaveBeenCalledWith(scope.container, [
      "variant_1",
    ])
    expect(mockedSyncCatalogProductsByIds).toHaveBeenCalledWith(
      scope.container,
      ["prod_1"]
    )
  })

  it.each([
    [
      InventoryEvents.INVENTORY_LEVEL_UPDATED,
      "inventory_level",
      "ilev_1",
    ],
    [
      InventoryEvents.RESERVATION_ITEM_CREATED,
      "reservation_item",
      "resitem_1",
    ],
  ])(
    "syncs affected products for %s",
    async (eventName, inventoryEntity, eventId) => {
      const scope = container()

      await syncCatalogIndex({
        event: {
          name: eventName,
          data: { id: eventId },
        },
        container: scope.container as any,
        pluginOptions: {},
      })

      expect(mockedProductIdsByInventoryEntityIds).toHaveBeenCalledWith(
        scope.container,
        inventoryEntity,
        [eventId]
      )
      expect(mockedSyncCatalogProductsByIds).toHaveBeenCalledWith(
        scope.container,
        ["prod_1"]
      )
      expect(mockedReindexCatalogDocuments).not.toHaveBeenCalled()
    }
  )

  it("runs a full reindex for inventory and variant deletion events", async () => {
    const scope = container()

    await syncCatalogIndex({
      event: {
        name: InventoryEvents.INVENTORY_LEVEL_DELETED,
        data: { id: "ilev_1" },
      },
      container: scope.container as any,
      pluginOptions: {},
    })
    await syncCatalogIndex({
      event: {
        name: ProductVariantWorkflowEvents.DELETED,
        data: { id: "variant_1" },
      },
      container: scope.container as any,
      pluginOptions: {},
    })

    expect(mockedReindexCatalogDocuments).toHaveBeenCalledTimes(2)
  })

  it("logs and rethrows errors so the event bus can retry", async () => {
    const scope = container()
    const error = new Error("meilisearch unavailable")

    mockedSyncCatalogProductsByIds.mockRejectedValue(error)

    await expect(
      syncCatalogIndex({
        event: {
          name: ProductWorkflowEvents.UPDATED,
          data: { id: "prod_1" },
        },
        container: scope.container as any,
        pluginOptions: {},
      })
    ).rejects.toThrow(error)

    expect(scope.logger.error).toHaveBeenCalledWith(
      "Catalog index sync failed for product.updated: meilisearch unavailable"
    )
  })
})
