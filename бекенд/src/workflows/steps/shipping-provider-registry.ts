import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { SHIPPING_PROVIDER_REGISTRY_MODULE } from "../../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../modules/shipping-provider-registry/service"
import type {
  SaveShippingProviderConfigInput,
  SaveShippingStorePackageInput,
} from "../../modules/shipping-provider-registry/service"

export const saveShippingProviderConfigStep = createStep(
  "save-shipping-provider-config",
  async (input: SaveShippingProviderConfigInput, { container }) => {
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    const previous = await service.getProviderConfig(input.providerKey)
    const result = await service.saveProviderConfig(input)
    return new StepResponse(result, { previous, createdId: previous ? null : result.id })
  },
  async (compensation, { container }) => {
    if (!compensation) return
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    if (compensation.previous) {
      await service.updateShippingProviderConfigs(compensation.previous)
    } else if (compensation.createdId) {
      await service.deleteShippingProviderConfigs(compensation.createdId)
    }
  }
)

export const saveShippingStorePackageStep = createStep(
  "save-shipping-store-package",
  async (input: SaveShippingStorePackageInput, { container }) => {
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    const previous = await service.getStorePackage()
    const result = await service.saveStorePackage(input)
    return new StepResponse(result, { previous, createdId: previous ? null : result.id })
  },
  async (compensation, { container }) => {
    if (!compensation) return
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    if (compensation.previous) {
      await service.updateShippingStorePackages(compensation.previous)
    } else if (compensation.createdId) {
      await service.deleteShippingStorePackages(compensation.createdId)
    }
  }
)

export type CreateShippingReturnRequestInput = {
  order_id: string
  provider_key: string
  reason?: string | null
  previous_delivery_status?: "placed" | "preparing" | "in_transit" | "delivered" | "cancelled" | "return_in_progress" | null
}

export const createShippingReturnRequestStep = createStep(
  "create-shipping-return-request",
  async (input: CreateShippingReturnRequestInput, { container }) => {
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    const result = await service.createShippingReturnRequests(input)
    return new StepResponse(result, result.id)
  },
  async (id, { container }) => {
    if (!id) return
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    await service.deleteShippingReturnRequests(id)
  }
)

export type UpdateShippingReturnRequestInput = {
  id: string
  status?: "pending" | "approved" | "rejected"
  reason?: string | null
  return_tracking_number?: string | null
  previous_delivery_status?: "placed" | "preparing" | "in_transit" | "delivered" | "cancelled" | "return_in_progress" | null
  return_provider_shipment_id?: string | null
  return_delivery_status?: "placed" | "preparing" | "in_transit" | "delivered" | "cancelled" | "return_in_progress" | null
  return_status_event_at?: Date | null
}

export const updateShippingReturnRequestStep = createStep(
  "update-shipping-return-request",
  async (input: UpdateShippingReturnRequestInput, { container }) => {
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    const previous = await service.retrieveShippingReturnRequest(input.id)
    const result = await service.updateShippingReturnRequests(input)
    return new StepResponse(result, previous)
  },
  async (previous, { container }) => {
    if (!previous) return
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    await service.updateShippingReturnRequests(previous)
  }
)

export const deleteShippingReturnRequestStep = createStep(
  "delete-shipping-return-request",
  async (id: string, { container }) => {
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    const previous = await service.retrieveShippingReturnRequest(id)
    await service.deleteShippingReturnRequests(id)
    return new StepResponse(id, previous)
  },
  async (previous, { container }) => {
    if (!previous) return
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    await service.createShippingReturnRequests(previous)
  }
)
