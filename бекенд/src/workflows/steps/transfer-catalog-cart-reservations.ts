import type {
  IInventoryService,
  InventoryTypes,
} from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import type { ExpectedCatalogReservation } from "./prepare-catalog-paid-order"

type TransferCatalogCartReservationsInput = {
  expected: ExpectedCatalogReservation[]
  order_items: Array<{
    id: string
    metadata?: Record<string, unknown> | null
  }>
}

type ReservationLineUpdate = InventoryTypes.UpdateReservationItemInput & {
  line_item_id: string
}

type TransferCompensation = {
  inventory_item_ids: string[]
  updates: ReservationLineUpdate[]
}

function reservationKey(lineItemId: string, inventoryItemId: string) {
  return `${lineItemId}:${inventoryItemId}`
}

export const transferCatalogCartReservationsStep = createStep(
  "transfer-catalog-cart-reservations",
  async (input: TransferCatalogCartReservationsInput, { container }) => {
    if (!input.expected.length) {
      return new StepResponse<
        InventoryTypes.ReservationItemDTO[],
        TransferCompensation
      >([], {
        inventory_item_ids: [],
        updates: [],
      })
    }

    const orderLineByCartLine = new Map<string, string>()

    for (const item of input.order_items) {
      const cartLineId = item.metadata?.catalog_cart_line_id

      if (typeof cartLineId === "string" && cartLineId) {
        orderLineByCartLine.set(cartLineId, item.id)
      }
    }

    const inventoryService = container.resolve(
      Modules.INVENTORY
    ) as IInventoryService
    const cartLineIds = Array.from(
      new Set(input.expected.map((item) => item.cart_line_id))
    )
    const reservations = await inventoryService.listReservationItems(
      { line_item_id: cartLineIds },
      { take: Math.max(input.expected.length + 1, 20) }
    )
    const expectedQuantities = new Map<string, number>()
    const actualQuantities = new Map<string, number>()

    for (const expected of input.expected) {
      const key = reservationKey(
        expected.cart_line_id,
        expected.inventory_item_id
      )
      expectedQuantities.set(
        key,
        (expectedQuantities.get(key) ?? 0) + expected.quantity
      )
    }

    for (const reservation of reservations) {
      if (!reservation.line_item_id) {
        continue
      }

      const key = reservationKey(
        reservation.line_item_id,
        reservation.inventory_item_id
      )
      actualQuantities.set(
        key,
        (actualQuantities.get(key) ?? 0) + Number(reservation.quantity)
      )
    }

    const reservationsMatch =
      expectedQuantities.size === actualQuantities.size &&
      Array.from(expectedQuantities).every(
        ([key, quantity]) => actualQuantities.get(key) === quantity
      ) &&
      cartLineIds.every((cartLineId) => orderLineByCartLine.has(cartLineId))

    if (!reservationsMatch) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Резерв корзины не соответствует позициям оплаченного заказа"
      )
    }

    const inventoryItemIds = Array.from(
      new Set(reservations.map((item) => item.inventory_item_id))
    )
    const updates = reservations.map((reservation) => ({
      id: reservation.id,
      line_item_id: orderLineByCartLine.get(reservation.line_item_id as string)!,
    }))
    const compensationUpdates = reservations.map((reservation) => ({
      id: reservation.id,
      line_item_id: reservation.line_item_id as string,
    }))
    const locking = container.resolve(Modules.LOCKING)
    const updated = await locking.execute(inventoryItemIds, async () => {
      // Medusa's reservation model supports line_item_id updates, while the
      // public DTO omits the field. Updating only this ownership pointer keeps
      // reserved_quantity unchanged and avoids a release/re-reserve gap.
      return await inventoryService.updateReservationItems(
        updates as InventoryTypes.UpdateReservationItemInput[]
      )
    })

    return new StepResponse(updated, {
      inventory_item_ids: inventoryItemIds,
      updates: compensationUpdates,
    } satisfies TransferCompensation)
  },
  async (compensation, { container }) => {
    if (!compensation?.updates.length) {
      return
    }

    const inventoryService = container.resolve(
      Modules.INVENTORY
    ) as IInventoryService
    const locking = container.resolve(Modules.LOCKING)

    await locking.execute(compensation.inventory_item_ids, async () => {
      await inventoryService.updateReservationItems(
        compensation.updates as InventoryTypes.UpdateReservationItemInput[]
      )
    })
  }
)
