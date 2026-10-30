import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"

import {
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../modules/shipping-provider-registry/service"
import type { ShippingProviderKey } from "../modules/shipping-provider-registry/service"
import { STORE_PICKUP_RETURN_PROVIDER_KEY } from "../modules/store-pickup/utils"

export const CATALOG_SHIPPING_RETURN_RESOLVED = "catalog.shipping_return_resolved"

export type ResolveShippingReturnRequestInput = {
  request_id: string
  decision: "approve" | "reject"
}

type RawOrder = {
  id: string
  email: string
  display_id?: number | null
  shipping_address?: {
    city?: string | null
    postal_code?: string | null
    address_1?: string | null
    first_name?: string | null
    last_name?: string | null
    phone?: string | null
  } | null
  items?: Array<{
    id: string
    title?: string | null
    variant_sku?: string | null
    quantity?: number | null
  }> | null
  shipping_methods?: Array<{ data?: Record<string, unknown> | null }> | null
}

export async function resolveShippingReturnRequest(
  container: MedusaContainer,
  input: ResolveShippingReturnRequestInput
) {
  const service = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const request = await service.retrieveShippingReturnRequest(input.request_id)
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)

  return locking.execute(request.order_id, async () => {
    const current = await service.retrieveShippingReturnRequest(input.request_id)
    if (current.status !== "pending") {
      if (current.status === (input.decision === "approve" ? "approved" : "rejected")) {
        return { request: current, changed: false, customer_email: null }
      }
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Решение по заявке уже принято и не может быть изменено."
      )
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id", "email", "display_id",
        "shipping_address.city", "shipping_address.postal_code",
        "shipping_address.address_1", "shipping_address.first_name",
        "shipping_address.last_name", "shipping_address.phone",
        "items.id", "items.title", "items.variant_sku", "items.quantity",
        "shipping_methods.data",
      ],
      filters: { id: current.order_id },
    }, { throwIfKeyNotFound: true })
    const order = data[0] as RawOrder | undefined
    if (!order?.id || !order.email) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ для заявки не найден.")
    }
    const [shipment] = await service.listShippingShipments({
      order_id: current.order_id,
      provider_key: current.provider_key,
      direction: "forward",
    })

    if (input.decision === "reject") {
      const updated = await service.updateShippingReturnRequests({
        id: current.id,
        status: "rejected",
      })
      if (shipment && current.previous_delivery_status) {
        await service.updateShippingShipments({
          id: shipment.id,
          simplified_status: current.previous_delivery_status,
        })
      }
      return { request: updated, changed: true, customer_email: order.email }
    }

    if (current.provider_key === STORE_PICKUP_RETURN_PROVIDER_KEY) {
      const updated = await service.updateShippingReturnRequests({
        id: current.id,
        status: "approved",
      })
      return { request: updated, changed: true, customer_email: order.email }
    }

    if (!shipment?.provider_shipment_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Для этой заявки нельзя автоматически создать обратную отправку."
      )
    }
    const created = await service.createCarrierReturnShipment(
      current.provider_key as ShippingProviderKey,
      {
        return_id: current.id,
        forward_shipment_id: shipment.provider_shipment_id,
        reason: current.reason ?? "customer_return",
        order,
      }
    )
    if (created.register_shipment) {
      const { shipment: returnShipment } = await service.claimShippingShipment({
        order_id: current.order_id,
        provider_key: current.provider_key,
        direction: "return",
        business_action_id: `return:${current.id}`,
        destination_key: current.provider_key,
      })
      await service.updateShippingShipments({
        id: returnShipment.id,
        status: "created",
        provider_shipment_id: created.id,
        tracking_number: created.tracking_number,
        simplified_status: "return_in_progress",
      })
    }
    const updated = await service.updateShippingReturnRequests({
      id: current.id,
      status: "approved",
      return_provider_shipment_id: created.id,
      ...(created.register_shipment ? { return_tracking_number: created.tracking_number } : {}),
      return_delivery_status: "placed",
    })
    return { request: updated, changed: true, customer_email: order.email }
  }, { timeout: 20 })
}

const resolveShippingReturnRequestStep = createStep(
  "resolve-shipping-return-request",
  async (input: ResolveShippingReturnRequestInput, { container }) =>
    new StepResponse(await resolveShippingReturnRequest(container, input))
)

export const resolveShippingReturnRequestWorkflow = createWorkflow(
  "resolve-shipping-return-request",
  function (input: ResolveShippingReturnRequestInput) {
    const resolved = resolveShippingReturnRequestStep(input)
    when({ resolved }, ({ resolved }) => resolved.changed).then(() =>
      emitEventStep({
        eventName: CATALOG_SHIPPING_RETURN_RESOLVED,
        data: {
          request_id: resolved.request.id,
          order_id: resolved.request.order_id,
          decision: resolved.request.status,
          customer_email: resolved.customer_email,
          return_tracking_number: resolved.request.return_tracking_number,
          provider_key: resolved.request.provider_key,
        },
      }).config({ name: "emit-catalog-shipping-return-resolved" })
    )
    return new WorkflowResponse(resolved)
  }
)
