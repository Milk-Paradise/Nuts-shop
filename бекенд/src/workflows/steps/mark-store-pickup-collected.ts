import type { IOrderModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  STORE_PICKUP_METADATA_KEYS,
  storePickupOrderState,
} from "../../modules/store-pickup/utils"

export function collectStorePickupMetadata(
  metadata: Record<string, unknown> | null | undefined,
  collectedAt: string
) {
  const state = storePickupOrderState(metadata)
  if (!state) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Отметка о выдаче доступна только для заказа с самовывозом."
    )
  }

  return {
    metadata: state.collected_at
      ? { ...(metadata ?? {}) }
      : {
          ...(metadata ?? {}),
          [STORE_PICKUP_METADATA_KEYS.collectedAt]: collectedAt,
        },
    collected_at: state.collected_at ?? collectedAt,
    changed: !state.collected_at,
  }
}

export const markStorePickupCollectedStep = createStep(
  "mark-store-pickup-collected",
  async (input: { order_id: string }, { container }) => {
    const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
    const order = await orderModule.retrieveOrder(input.order_id, {
      select: ["id", "metadata"],
    })
    const previousMetadata = { ...(order.metadata ?? {}) }
    const collected = collectStorePickupMetadata(
      order.metadata,
      new Date().toISOString()
    )

    if (collected.changed) {
      await orderModule.updateOrders(order.id, { metadata: collected.metadata })
    }

    return new StepResponse(
      {
        order_id: order.id,
        collected_at: collected.collected_at,
        changed: collected.changed,
      },
      collected.changed
        ? { order_id: order.id, metadata: previousMetadata }
        : null
    )
  },
  async (
    previous: { order_id: string; metadata: Record<string, unknown> } | null | undefined,
    { container }
  ) => {
    if (!previous) return
    const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
    await orderModule.updateOrders(previous.order_id, {
      metadata: previous.metadata,
    })
  }
)
