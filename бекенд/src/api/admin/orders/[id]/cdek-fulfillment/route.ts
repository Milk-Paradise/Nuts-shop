import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  CDEK_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../../../../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../../../../modules/shipping-provider-registry/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const [shipment] = await service.listShippingShipments({
    order_id: req.params.id,
    provider_key: CDEK_PROVIDER_KEY,
    direction: "forward",
  })

  res.json({
    shipment: shipment
      ? {
          status: shipment.status,
          tracking_number: shipment.tracking_number,
          simplified_status: shipment.simplified_status,
          label_ready: !!shipment.label_url,
          error_message: shipment.error_message,
          updated_at: shipment.updated_at,
        }
      : null,
  })
}
