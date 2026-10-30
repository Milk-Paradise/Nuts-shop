import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"

import {
  CDEK_PROVIDER_KEY,
  OZON_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../modules/shipping-provider-registry/service"
import { CATALOG_SHIPPING_RETURN_REQUESTED } from "./cancel-catalog-customer-order"
import { createCatalogShippingReturnRequest } from "./steps/create-catalog-shipping-return-request"
import {
  STORE_PICKUP_RETURN_PROVIDER_KEY,
  storePickupOrderState,
} from "../modules/store-pickup/utils"

export type RequestCatalogShippingReturnInput = {
  order_id: string
  customer_id: string
  customer_email: string
  reason?: string | null
}

export async function requestCatalogShippingReturn(
  container: MedusaContainer,
  input: RequestCatalogShippingReturnInput
) {
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  return locking.execute(input.order_id, async () => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "email", "customer.id", "status", "metadata"],
      filters: { id: input.order_id },
    })
    const order = data[0] as {
      id?: string
      email?: string
      customer?: { id?: string } | null
      status?: string
      metadata?: Record<string, unknown> | null
    } | undefined
    const email = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : ""
    if (!order?.id || (order.customer?.id !== input.customer_id &&
      email(order.email) !== email(input.customer_email))) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ не найден.")
    }
    if (order.status === "canceled") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Отменённый заказ нельзя вернуть.")
    }
    const pickup = storePickupOrderState(order.metadata)
    if (pickup) {
      if (!pickup.collected_at) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "Заявка на возврат доступна после выдачи заказа."
        )
      }
      return createCatalogShippingReturnRequest(container, {
        order_id: input.order_id,
        provider_key: STORE_PICKUP_RETURN_PROVIDER_KEY,
        reason: input.reason ?? "Возврат запрошен покупателем",
        previous_delivery_status: "delivered",
      })
    }
    const service = container.resolve<ShippingProviderRegistryModuleService>(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    const [shipment] = await service.listShippingShipments({
      order_id: input.order_id,
      provider_key: CDEK_PROVIDER_KEY,
    })
    const [ozonShipment] = shipment ? [] : await service.listShippingShipments({
      order_id: input.order_id,
      provider_key: OZON_PROVIDER_KEY,
    })
    const activeShipment = shipment ?? ozonShipment
    if (!activeShipment || activeShipment.simplified_status === "placed" ||
      activeShipment.simplified_status === "cancelled") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Заявка на возврат пока недоступна для этого заказа."
      )
    }
    return createCatalogShippingReturnRequest(container, {
      order_id: input.order_id,
      reason: input.reason ?? "Возврат запрошен покупателем",
      provider_key: activeShipment.provider_key,
      previous_delivery_status: activeShipment.simplified_status,
    })
  }, { timeout: 15 })
}

const requestCatalogShippingReturnStep = createStep(
  "request-catalog-shipping-return",
  async (input: RequestCatalogShippingReturnInput, { container }) =>
    new StepResponse(await requestCatalogShippingReturn(container, input))
)

export const requestCatalogShippingReturnWorkflow = createWorkflow(
  "request-catalog-shipping-return",
  function (input: RequestCatalogShippingReturnInput) {
    const result = requestCatalogShippingReturnStep(input)
    when({ result }, ({ result }) => result.created).then(() =>
      emitEventStep({
        eventName: CATALOG_SHIPPING_RETURN_REQUESTED,
        data: {
          order_id: input.order_id,
          customer_email: input.customer_email,
          return_request_id: result.request.id,
          provider_key: result.request.provider_key,
        },
      }).config({ name: "emit-customer-shipping-return-requested" })
    )
    return new WorkflowResponse(result)
  }
)
