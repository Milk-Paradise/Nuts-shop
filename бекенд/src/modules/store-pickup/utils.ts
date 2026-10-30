import type { MedusaContainer } from "@medusajs/framework/types"

import { STORE_PICKUP_MODULE } from "./module-key"
import type StorePickupModuleService from "./service"

export const STORE_PICKUP_SETTING_ID = "default"
export const STORE_PICKUP_NORMALIZED_OPTION_ID = "store-pickup"
export const STORE_PICKUP_FULFILLMENT_PROVIDER_ID = "manual_manual"
export const STORE_PICKUP_RETURN_PROVIDER_KEY = "store_pickup"

export const STORE_PICKUP_METADATA_KEYS = {
  enabled: "store_pickup",
  address: "store_pickup_address",
  hours: "store_pickup_hours",
  collectedAt: "store_pickup_collected_at",
} as const

export type StorePickupSettings = {
  id: string
  address: string
  hours: string
  is_enabled: boolean
}

export type StorePickupSnapshot = {
  address: string
  hours: string
}

export type StorePickupOrderState = StorePickupSnapshot & {
  is_pickup: boolean
  collected_at: string | null
}

export function isStorePickupAvailable(
  settings: Pick<StorePickupSettings, "address" | "is_enabled"> | null | undefined
) {
  return settings?.is_enabled === true && settings.address.trim().length > 0
}

export function isStorePickupShippingOption(option: {
  provider_id?: string | null
  data?: Record<string, unknown> | null
}) {
  return (
    option.provider_id === STORE_PICKUP_FULFILLMENT_PROVIDER_ID &&
    option.data?.store_pickup === true
  )
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function storePickupOrderState(
  metadata: Record<string, unknown> | null | undefined
): StorePickupOrderState | null {
  const address = cleanText(metadata?.[STORE_PICKUP_METADATA_KEYS.address])
  const hours = cleanText(metadata?.[STORE_PICKUP_METADATA_KEYS.hours])
  const collectedAt = cleanText(metadata?.[STORE_PICKUP_METADATA_KEYS.collectedAt])

  if (metadata?.[STORE_PICKUP_METADATA_KEYS.enabled] !== true || !address) {
    return null
  }

  return {
    is_pickup: true,
    address,
    hours: hours ?? "",
    collected_at: collectedAt,
  }
}

export function storePickupSnapshotFromMethods(
  methods: Array<{ data?: Record<string, unknown> | null }> | null | undefined
): StorePickupSnapshot | null {
  for (const method of methods ?? []) {
    const pickup = method.data?.store_pickup
    if (!pickup || typeof pickup !== "object") continue

    const value = pickup as Record<string, unknown>
    const address = cleanText(value.address)
    if (!address) continue

    return {
      address,
      hours: cleanText(value.hours) ?? "",
    }
  }

  return null
}

export async function retrieveStorePickupSettings(
  container: Pick<MedusaContainer, "resolve">
): Promise<StorePickupSettings | null> {
  const service = container.resolve<StorePickupModuleService>(STORE_PICKUP_MODULE)
  const [settings] = await service.listStorePickupSettings({
    id: STORE_PICKUP_SETTING_ID,
  })

  return (settings as StorePickupSettings | undefined) ?? null
}
