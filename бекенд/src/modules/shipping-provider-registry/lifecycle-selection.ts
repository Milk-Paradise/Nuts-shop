import { CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY } from "./provider-keys"

export type OrderShippingSnapshot = {
  shipping_methods?: Array<{
    shipping_option?: { provider_id?: string | null } | null
  }> | null
}

export const managedDeliveryProviderKeys = [
  CDEK_PROVIDER_KEY,
  OZON_PROVIDER_KEY,
] as const

export const automaticReturnShipmentProviderKeys = [
  CDEK_PROVIDER_KEY,
  OZON_PROVIDER_KEY,
] as const

export function supportsAutomaticReturnShipment(providerKey: string) {
  return automaticReturnShipmentProviderKeys.includes(
    providerKey as typeof automaticReturnShipmentProviderKeys[number]
  )
}

export function selectedVisibleDeliveryProviderKeys(order: OrderShippingSnapshot | undefined) {
  const optionProviderIds = new Set(
    (order?.shipping_methods ?? [])
      .map((method) => method.shipping_option?.provider_id)
      .filter((providerId): providerId is string => typeof providerId === "string")
  )

  return managedDeliveryProviderKeys.filter((providerKey) => optionProviderIds.has(providerKey))
}
