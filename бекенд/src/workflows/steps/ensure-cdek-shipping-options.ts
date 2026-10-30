import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"

import { CDEK_PROVIDER_KEY } from "../../modules/shipping-provider-registry"

export const ensureCdekShippingOptionsStep = createStep(
  "ensure-cdek-shipping-options",
  async (input: { enabled: boolean }, { container }) => {
    const query = container.resolve("query")
    const fulfillment = container.resolve(Modules.FULFILLMENT)
    const storedCdek = await fulfillment.listShippingOptions(
      { provider_id: CDEK_PROVIDER_KEY } as any,
      { take: 10_000, withDeleted: true }
    )

    if (!input.enabled) {
      const activeIds = storedCdek
        .filter((option) => !option.deleted_at)
        .map((option) => option.id)
      if (activeIds.length) await fulfillment.deleteShippingOptions(activeIds)
      return new StepResponse({ created: 0, restored: 0, disabled: activeIds.length }, {
        createdIds: [], restoredIds: [], disabledIds: activeIds,
      })
    }

    const restoreIds = storedCdek
      .filter((option) => option.deleted_at)
      .map((option) => option.id)
    if (restoreIds.length) await fulfillment.restoreShippingOptions(restoreIds)
    const { data: existing } = await query.graph({
      entity: "shipping_option",
      fields: ["id", "provider_id", "service_zone_id", "shipping_profile_id", "data"],
    })
    const existingCdek = new Set(
      existing
        .filter((option) => option.provider_id === CDEK_PROVIDER_KEY)
        .map((option) => `${option.service_zone_id}:${option.shipping_profile_id}:${option.data?.delivery_type}`)
    )
    const pairs = new Map<string, { service_zone_id: string; shipping_profile_id: string }>()
    for (const option of existing) {
      if (!option.service_zone_id || !option.shipping_profile_id) continue
      const key = `${option.service_zone_id}:${option.shipping_profile_id}`
      pairs.set(key, {
        service_zone_id: option.service_zone_id,
        shipping_profile_id: option.shipping_profile_id,
      })
    }

    const inputs = Array.from(pairs.values()).flatMap((pair) =>
      (["courier", "pickup"] as const).flatMap((deliveryType) => {
        const key = `${pair.service_zone_id}:${pair.shipping_profile_id}:${deliveryType}`
        if (existingCdek.has(key)) return []
        return [{
          name: deliveryType === "courier" ? "СДЭК: курьер" : "СДЭК: пункт выдачи",
          price_type: "calculated" as const,
          provider_id: CDEK_PROVIDER_KEY,
          service_zone_id: pair.service_zone_id,
          shipping_profile_id: pair.shipping_profile_id,
          data: { delivery_type: deliveryType },
          type: {
            label: deliveryType === "courier" ? "Курьер" : "ПВЗ",
            description: "Расчёт СДЭК в реальном времени",
            code: `cdek-${deliveryType}`,
          },
        }]
      })
    )

    if (!inputs.length) return new StepResponse(
      { created: 0, restored: restoreIds.length, disabled: 0 },
      { createdIds: [], restoredIds: restoreIds, disabledIds: [] }
    )
    const { result } = await createShippingOptionsWorkflow(container).run({ input: inputs })
    return new StepResponse(
      { created: result.length, restored: restoreIds.length, disabled: 0 },
      {
        createdIds: result.map((option) => option.id),
        restoredIds: restoreIds,
        disabledIds: [],
      }
    )
  },
  async (state: {
    createdIds: string[]
    restoredIds: string[]
    disabledIds: string[]
  } | undefined, { container }) => {
    if (!state) return
    const service = container.resolve(Modules.FULFILLMENT)
    if (state.createdIds.length) await service.deleteShippingOptions(state.createdIds)
    if (state.restoredIds.length) await service.deleteShippingOptions(state.restoredIds)
    if (state.disabledIds.length) await service.restoreShippingOptions(state.disabledIds)
  }
)
