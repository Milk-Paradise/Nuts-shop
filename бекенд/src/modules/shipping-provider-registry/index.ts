import ShippingProviderRegistryModuleService from "./service"
import { Module } from "@medusajs/framework/utils"
export { CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY } from "./provider-keys"

export const SHIPPING_PROVIDER_REGISTRY_MODULE = "shippingProviderRegistry"

export * from "./delivery-core"
export * from "./lifecycle-selection"
export * from "./lifecycle-shipments"
export * from "./shipping-provider-error"

export default Module(SHIPPING_PROVIDER_REGISTRY_MODULE, {
  service: ShippingProviderRegistryModuleService,
})
