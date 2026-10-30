import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { retrieveAccountCustomer, retrieveAccountOrder } from "../../utils"
import {
  CDEK_PROVIDER_KEY,
  OZON_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../../../../../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../../../../../modules/shipping-provider-registry/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customer = await retrieveAccountCustomer(req)
  // Reuses the same ownership check as the order detail endpoint — throws
  // NOT_FOUND if the order doesn't exist or doesn't belong to this customer.
  const order = await retrieveAccountOrder(req.scope, customer, req.params.id)
  if (order.store_pickup) {
    return res.status(200).json({ result: { status: "unchanged", tracking: null } })
  }

  const shippingRegistry = req.scope.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const [cdekShipment] = await shippingRegistry.listShippingShipments({
    order_id: req.params.id,
    provider_key: CDEK_PROVIDER_KEY,
  })
  const [ozonShipment] = cdekShipment ? [] : await shippingRegistry.listShippingShipments({
    order_id: req.params.id,
    provider_key: OZON_PROVIDER_KEY,
  })
  const shipment = cdekShipment ?? ozonShipment
  if (shipment) {
    return res.status(200).json({
      result: {
        status: "unchanged",
        tracking: {
          status: shipment.simplified_status,
          trackingNumber: shipment.tracking_number,
          trackingUrl: null,
          polledAt: (shipment.status_event_at ?? shipment.updated_at).toISOString(),
        },
      },
    })
  }

  return res.status(200).json({ result: { status: "unchanged", tracking: null } })
}
