import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { SHIPPING_PROVIDER_REGISTRY_MODULE } from "../../../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../../modules/shipping-provider-registry/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const requests = await service.listShippingReturnRequests(
    { status: "pending" },
    { order: { created_at: "DESC" } }
  )
  res.status(200).json({ return_requests: requests })
}
