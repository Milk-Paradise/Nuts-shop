import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  InventoryEvents,
  ProductCategoryWorkflowEvents,
  ProductVariantWorkflowEvents,
  ProductWorkflowEvents,
} from "@medusajs/framework/utils"

import {
  type InventoryEntity,
  productIdsByInventoryEntityIds,
  productIdsByVariantIds,
  reindexCatalogDocuments,
  syncCatalogProductsByIds,
} from "../modules/meilisearch/sync"

type EntityEventPayload = {
  id?: string
  ids?: string[]
}

const productEvents = [
  ProductWorkflowEvents.CREATED,
  ProductWorkflowEvents.UPDATED,
  ProductWorkflowEvents.DELETED,
]

const productVariantEvents = [
  ProductVariantWorkflowEvents.CREATED,
  ProductVariantWorkflowEvents.UPDATED,
  ProductVariantWorkflowEvents.DELETED,
]

const categoryEvents = [
  ProductCategoryWorkflowEvents.CREATED,
  ProductCategoryWorkflowEvents.UPDATED,
  ProductCategoryWorkflowEvents.DELETED,
]

const inventoryItemSyncEvents = [
  InventoryEvents.INVENTORY_ITEM_CREATED,
  InventoryEvents.INVENTORY_ITEM_UPDATED,
  InventoryEvents.INVENTORY_ITEM_RESTORED,
]

const inventoryLevelSyncEvents = [
  InventoryEvents.INVENTORY_LEVEL_CREATED,
  InventoryEvents.INVENTORY_LEVEL_UPDATED,
  InventoryEvents.INVENTORY_LEVEL_RESTORED,
]

const reservationItemSyncEvents = [
  InventoryEvents.RESERVATION_ITEM_CREATED,
  InventoryEvents.RESERVATION_ITEM_UPDATED,
  InventoryEvents.RESERVATION_ITEM_RESTORED,
]

const inventoryDeletionEvents = [
  InventoryEvents.INVENTORY_ITEM_DELETED,
  InventoryEvents.INVENTORY_LEVEL_DELETED,
  InventoryEvents.RESERVATION_ITEM_DELETED,
]

const inventoryEvents = [
  ...inventoryItemSyncEvents,
  ...inventoryLevelSyncEvents,
  ...reservationItemSyncEvents,
  ...inventoryDeletionEvents,
]

function payloadIds(payload: EntityEventPayload) {
  if (payload.ids?.length) {
    return payload.ids
  }

  return payload.id ? [payload.id] : []
}

function isEvent(name: string, events: string[]) {
  return events.includes(name)
}

function inventoryEntityForEvent(name: string): InventoryEntity | undefined {
  if (isEvent(name, inventoryItemSyncEvents)) {
    return "inventory_item"
  }

  if (isEvent(name, inventoryLevelSyncEvents)) {
    return "inventory_level"
  }

  if (isEvent(name, reservationItemSyncEvents)) {
    return "reservation_item"
  }
}

export default async function syncCatalogIndex({
  event,
  container,
}: SubscriberArgs<EntityEventPayload>) {
  const logger = container.resolve("logger")
  const eventName = event.name
  const ids = payloadIds(event.data ?? {})

  try {
    if (eventName === ProductWorkflowEvents.DELETED) {
      const result = await syncCatalogProductsByIds(container, ids)
      logger.info(
        `Catalog index sync handled ${eventName}: ${result.deleted} document(s) deleted.`
      )
      return
    }

    if (isEvent(eventName, productEvents)) {
      const result = await syncCatalogProductsByIds(container, ids)
      logger.info(
        `Catalog index sync handled ${eventName}: ${result.indexed} document(s) indexed, ${result.deleted} deleted, ${result.skipped} skipped.`
      )
      return
    }

    if (
      eventName === ProductVariantWorkflowEvents.CREATED ||
      eventName === ProductVariantWorkflowEvents.UPDATED
    ) {
      const productIds = await productIdsByVariantIds(container, ids)
      const result = await syncCatalogProductsByIds(container, productIds)

      logger.info(
        `Catalog index sync handled ${eventName}: ${result.indexed} document(s) indexed, ${result.deleted} deleted, ${result.skipped} skipped.`
      )
      return
    }

    const inventoryEntity = inventoryEntityForEvent(eventName)

    if (inventoryEntity) {
      const productIds = await productIdsByInventoryEntityIds(
        container,
        inventoryEntity,
        ids
      )
      const result = await syncCatalogProductsByIds(container, productIds)

      logger.info(
        `Catalog index sync handled ${eventName}: ${result.indexed} document(s) indexed, ${result.deleted} deleted, ${result.skipped} skipped.`
      )
      return
    }

    if (
      eventName === ProductVariantWorkflowEvents.DELETED ||
      isEvent(eventName, categoryEvents) ||
      isEvent(eventName, inventoryDeletionEvents)
    ) {
      const result = await reindexCatalogDocuments(container)

      logger.info(
        `Catalog index sync handled ${eventName}: full reindex indexed ${result.indexed} document(s), ${result.skipped} skipped.`
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    logger.error(`Catalog index sync failed for ${eventName}: ${message}`)
    throw error
  }
}

export const config: SubscriberConfig = {
  event: [
    ...productEvents,
    ...productVariantEvents,
    ...categoryEvents,
    ...inventoryEvents,
  ],
  context: {
    subscriberId: "catalog-index-sync",
  },
}
