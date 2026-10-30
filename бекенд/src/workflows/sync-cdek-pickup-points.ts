import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  CDEK_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../modules/shipping-provider-registry"
import { decryptShippingProviderCredentials } from "../modules/shipping-provider-registry/credentials"
import type ShippingProviderRegistryModuleService from "../modules/shipping-provider-registry/service"

type CdekDeliveryPoint = {
  code: string
  name: string
  type: string
  work_time: string | null
  location: {
    city: string
    city_code: number | null
    address: string
    address_full: string | null
    latitude: number | null
    longitude: number | null
  }
}

function pointId(code: string) {
  return `cdek_${code.replace(/[^a-zA-Z0-9_-]/g, "_")}`
}

function toStoredPoint(point: CdekDeliveryPoint) {
  return {
    id: pointId(point.code),
    provider_key: CDEK_PROVIDER_KEY,
    external_id: point.code,
    name: point.name,
    city: point.location.city,
    city_code: point.location.city_code,
    address: point.location.address_full ?? point.location.address,
    lat: point.location.latitude,
    lng: point.location.longitude,
    schedule: point.work_time,
    point_type: point.type,
  }
}

export async function syncCdekPickupPoints(
  container: Pick<MedusaContainer, "resolve">
) {
  const service = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const [visibility] = await service.listShippingProviderVisibilities({
    provider_key: CDEK_PROVIDER_KEY,
  })
  if (!visibility?.is_visible) return { synced: 0, skipped: true }

  const config = await service.getProviderConfig(CDEK_PROVIDER_KEY)
  if (!config?.encrypted_credentials) return { synced: 0, skipped: true }

  const points = await service.listCdekPickupPoints(
    decryptShippingProviderCredentials(config.encrypted_credentials)
  )
  const records = points.map(toStoredPoint)
  const existing: Awaited<ReturnType<typeof service.listShippingPickupPoints>> = []
  const pageSize = 1_000
  for (let skip = 0; ; skip += pageSize) {
    const page = await service.listShippingPickupPoints(
      { provider_key: CDEK_PROVIDER_KEY },
      { take: pageSize, skip, withDeleted: true } as any
    )
    existing.push(...page)
    if (page.length < pageSize) break
  }
  const existingIds = new Set(existing.map((point) => point.id))
  const currentIds = new Set(records.map((point) => point.id))
  const creates = records.filter((point) => !existingIds.has(point.id))
  const updates = records.filter((point) => existingIds.has(point.id))
  const restoreIds = existing
    .filter((point) => point.deleted_at && currentIds.has(point.id))
    .map((point) => point.id)
  const staleIds = existing
    .filter((point) => !point.deleted_at && !currentIds.has(point.id))
    .map((point) => point.id)

  if (creates.length) await service.createShippingPickupPoints(creates)
  if (restoreIds.length) await service.restoreShippingPickupPoints(restoreIds)
  if (updates.length) await service.updateShippingPickupPoints(updates)
  if (staleIds.length) await service.deleteShippingPickupPoints(staleIds)

  return { synced: records.length, removed: staleIds.length, skipped: false }
}

const syncCdekPickupPointsStep = createStep(
  "sync-cdek-pickup-points",
  async (_input: Record<string, never>, { container }) =>
    new StepResponse(await syncCdekPickupPoints(container))
)

export const syncCdekPickupPointsWorkflow = createWorkflow(
  "sync-cdek-pickup-points",
  function () {
    return new WorkflowResponse(syncCdekPickupPointsStep({}))
  }
)
