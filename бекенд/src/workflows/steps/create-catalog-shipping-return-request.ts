import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  CDEK_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../modules/shipping-provider-registry/service"

export type CreateCatalogShippingReturnRequestInput = {
  order_id: string
  provider_key?: string
  reason?: string | null
  previous_delivery_status: "placed" | "preparing" | "in_transit" | "delivered" | "return_in_progress"
}

export async function createCatalogShippingReturnRequest(
  container: MedusaContainer,
  input: CreateCatalogShippingReturnRequestInput
) {
  const service = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const providerKey = input.provider_key ?? CDEK_PROVIDER_KEY
  const [existing] = await service.listShippingReturnRequests({
    order_id: input.order_id,
    status: "pending",
  })
  if (existing) return { request: existing, created: false }

  const request = await service.createShippingReturnRequests({
    order_id: input.order_id,
    provider_key: providerKey,
    status: "pending",
    reason: input.reason ?? null,
    previous_delivery_status: input.previous_delivery_status,
  })
  const shipments = await service.listShippingShipments({
    order_id: input.order_id,
    provider_key: providerKey,
    direction: "forward",
  })
  const shipment = shipments.find(({ direction }) => direction === "forward")
  if (shipment) {
    await service.updateShippingShipments({
      id: shipment.id,
      simplified_status: "return_in_progress",
    })
  }
  return { request, created: true }
}

export const createCatalogShippingReturnRequestStep = createStep(
  "create-catalog-shipping-return-request",
  async (input: CreateCatalogShippingReturnRequestInput, { container }) => {
    const result = await createCatalogShippingReturnRequest(container, input)
    return new StepResponse(result, result.created ? {
      request_id: result.request.id,
      order_id: input.order_id,
      provider_key: input.provider_key ?? CDEK_PROVIDER_KEY,
      previous_delivery_status: input.previous_delivery_status,
    } : null)
  },
  async (compensation, { container }) => {
    if (!compensation) return
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    await service.deleteShippingReturnRequests(compensation.request_id)
    const shipments = await service.listShippingShipments({
      order_id: compensation.order_id,
      provider_key: compensation.provider_key,
      direction: "forward",
    })
    const shipment = shipments.find(({ direction }) => direction === "forward")
    if (shipment) {
      await service.updateShippingShipments({
        id: shipment.id,
        simplified_status: compensation.previous_delivery_status,
      })
    }
  }
)
