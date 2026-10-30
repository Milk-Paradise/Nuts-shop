import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"

import {
  STORE_PICKUP_FULFILLMENT_PROVIDER_ID,
  isStorePickupAvailable,
  isStorePickupShippingOption,
} from "../../modules/store-pickup/utils"

type ShippingOptionRecord = {
  id: string
  service_zone_id?: string | null
  shipping_profile_id?: string | null
  provider_id?: string | null
  data?: Record<string, unknown> | null
  deleted_at?: Date | string | null
}

type EnsureState = {
  createdIds: string[]
  restoredIds: string[]
  disabledIds: string[]
}

function pairKey(option: ShippingOptionRecord) {
  return `${option.service_zone_id}:${option.shipping_profile_id}`
}

export function planStorePickupShippingOptions(
  sourceOptions: ShippingOptionRecord[],
  pickupOptions: ShippingOptionRecord[]
) {
  const pairs = new Map<
    string,
    { service_zone_id: string; shipping_profile_id: string }
  >()
  for (const option of sourceOptions) {
    if (!option.service_zone_id || !option.shipping_profile_id) continue
    pairs.set(pairKey(option), {
      service_zone_id: option.service_zone_id,
      shipping_profile_id: option.shipping_profile_id,
    })
  }

  const activeByPair = new Map<string, ShippingOptionRecord[]>()
  const deletedByPair = new Map<string, ShippingOptionRecord[]>()
  for (const option of pickupOptions) {
    if (!option.service_zone_id || !option.shipping_profile_id) continue
    const target = option.deleted_at ? deletedByPair : activeByPair
    const key = pairKey(option)
    target.set(key, [...(target.get(key) ?? []), option])
  }

  const duplicateIds: string[] = []
  const restoreIds: string[] = []
  const missingPairs: Array<{
    service_zone_id: string
    shipping_profile_id: string
  }> = []
  for (const [key, pair] of pairs) {
    const active = activeByPair.get(key) ?? []
    if (active.length) {
      duplicateIds.push(...active.slice(1).map((option) => option.id))
      continue
    }

    const deleted = deletedByPair.get(key) ?? []
    if (deleted.length) {
      restoreIds.push(deleted[0].id)
      continue
    }

    missingPairs.push(pair)
  }

  return { duplicateIds, restoreIds, missingPairs }
}

export const ensureStorePickupShippingOptionsStep = createStep(
  "ensure-store-pickup-shipping-options",
  async (
    input: { address: string; is_enabled: boolean },
    { container }
  ) => {
    const fulfillment = container.resolve(Modules.FULFILLMENT)
    const allManualOptions = await fulfillment.listShippingOptions(
      { provider_id: STORE_PICKUP_FULFILLMENT_PROVIDER_ID } as any,
      { take: 10_000, withDeleted: true }
    ) as ShippingOptionRecord[]
    const pickupOptions = allManualOptions.filter(isStorePickupShippingOption)

    if (!isStorePickupAvailable(input)) {
      const activeIds = pickupOptions
        .filter((option) => !option.deleted_at)
        .map((option) => option.id)
      if (activeIds.length) {
        await fulfillment.deleteShippingOptions(activeIds)
      }

      return new StepResponse(
        { created: 0, restored: 0, disabled: activeIds.length },
        { createdIds: [], restoredIds: [], disabledIds: activeIds } satisfies EnsureState
      )
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: activeOptions } = await query.graph({
      entity: "shipping_option",
      fields: [
        "id",
        "provider_id",
        "service_zone_id",
        "shipping_profile_id",
        "data",
      ],
    })
    const sourceOptions = (activeOptions as ShippingOptionRecord[]).filter(
      (option) => !isStorePickupShippingOption(option)
    )
    const { duplicateIds, restoreIds, missingPairs } =
      planStorePickupShippingOptions(sourceOptions, pickupOptions)

    if (duplicateIds.length) {
      await fulfillment.deleteShippingOptions(duplicateIds)
    }
    if (restoreIds.length) {
      await fulfillment.restoreShippingOptions(restoreIds)
    }

    const inputs = missingPairs.map((pair) => ({
      name: "Самовывоз",
      price_type: "flat" as const,
      provider_id: STORE_PICKUP_FULFILLMENT_PROVIDER_ID,
      service_zone_id: pair.service_zone_id,
      shipping_profile_id: pair.shipping_profile_id,
      data: { store_pickup: true },
      prices: [{ amount: 0, currency_code: "rub" }],
      type: {
        label: "Самовывоз",
        description: "Бесплатное получение в магазине",
        code: "store-pickup",
      },
    }))
    const created = inputs.length
      ? (await createShippingOptionsWorkflow(container).run({ input: inputs })).result
      : []
    const createdIds = created.map((option) => option.id)

    return new StepResponse(
      {
        created: createdIds.length,
        restored: restoreIds.length,
        disabled: duplicateIds.length,
      },
      {
        createdIds,
        restoredIds: restoreIds,
        disabledIds: duplicateIds,
      } satisfies EnsureState
    )
  },
  async (state: EnsureState | undefined, { container }) => {
    if (!state) return

    const fulfillment = container.resolve(Modules.FULFILLMENT)
    if (state.createdIds.length) {
      await fulfillment.deleteShippingOptions(state.createdIds)
    }
    if (state.restoredIds.length) {
      await fulfillment.deleteShippingOptions(state.restoredIds)
    }
    if (state.disabledIds.length) {
      await fulfillment.restoreShippingOptions(state.disabledIds)
    }
  }
)
