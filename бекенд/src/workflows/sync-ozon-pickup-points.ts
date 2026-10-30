import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse, createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { OZON_PROVIDER_KEY, SHIPPING_PROVIDER_REGISTRY_MODULE } from "../modules/shipping-provider-registry"
import { decryptShippingProviderCredentials } from "../modules/shipping-provider-registry/credentials"
import type ShippingProviderRegistryModuleService from "../modules/shipping-provider-registry/service"

type PickupPoint = {
  id: string
  name: string
  address: string
  city: string | null
  latitude: number | null
  longitude: number | null
  working_hours: string | null
}

function pointId(id: string) {
  return `ozon_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`
}

function toStoredPoint(point: PickupPoint) {
  return {
    id: pointId(point.id),
    provider_key: OZON_PROVIDER_KEY,
    external_id: point.id,
    name: point.name,
    city: point.city ?? "",
    city_code: null,
    address: point.address,
    lat: point.latitude,
    lng: point.longitude,
    schedule: point.working_hours,
    point_type: "pickup",
  }
}

export async function syncOzonPickupPoints(
  container: Pick<MedusaContainer, "resolve">
) {
  const service = container.resolve<ShippingProviderRegistryModuleService>(SHIPPING_PROVIDER_REGISTRY_MODULE)
  const [visibility] = await service.listShippingProviderVisibilities({ provider_key: OZON_PROVIDER_KEY })
  if (!visibility?.is_visible) return { synced: 0, skipped: true }
  const config = await service.getProviderConfig(OZON_PROVIDER_KEY)
  if (!config?.encrypted_credentials) return { synced: 0, skipped: true }

  const points = await service.listOzonPickupPoints(
    decryptShippingProviderCredentials(config.encrypted_credentials)
  )
  const records = points.map(toStoredPoint)
  const existing: Awaited<ReturnType<typeof service.listShippingPickupPoints>> = []
  const pageSize = 1_000
  for (let skip = 0; ; skip += pageSize) {
    const page = await service.listShippingPickupPoints(
      { provider_key: OZON_PROVIDER_KEY },
      { take: pageSize, skip, withDeleted: true } as any
    )
    existing.push(...page)
    if (page.length < pageSize) break
  }
  const existingIds = new Set(existing.map((point) => point.id))
  const currentIds = new Set(records.map((point) => point.id))
  const creates = records.filter((point) => !existingIds.has(point.id))
  const updates = records.filter((point) => existingIds.has(point.id))
  const restoreIds = existing.filter((point) => point.deleted_at && currentIds.has(point.id)).map((point) => point.id)
  const staleIds = existing.filter((point) => !point.deleted_at && !currentIds.has(point.id)).map((point) => point.id)
  if (creates.length) await service.createShippingPickupPoints(creates)
  if (restoreIds.length) await service.restoreShippingPickupPoints(restoreIds)
  if (updates.length) await service.updateShippingPickupPoints(updates)
  if (staleIds.length) await service.deleteShippingPickupPoints(staleIds)
  return { synced: records.length, removed: staleIds.length, skipped: false }
}

const syncOzonPickupPointsStep = createStep(
  "sync-ozon-pickup-points",
  async (_input: Record<string, never>, { container }) => new StepResponse(await syncOzonPickupPoints(container))
)

export const syncOzonPickupPointsWorkflow = createWorkflow(
  "sync-ozon-pickup-points",
  function () {
    return new WorkflowResponse(syncOzonPickupPointsStep({}))
  }
)
