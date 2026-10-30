import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { SHIPPING_PROVIDER_REGISTRY_MODULE } from "../../../../modules/shipping-provider-registry"
import { STORE_PACKAGE_MISSING_REASON } from "../../../../modules/shipping-provider-registry/store-package"
import type ShippingProviderRegistryModuleService from "../../../../modules/shipping-provider-registry/service"
import { saveShippingStorePackageWorkflow } from "../../../../workflows/save-shipping-store-package"
import { serializeStorePackage } from "../serializers"
import type { SaveShippingStorePackageBody } from "../validators"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const storePackage = await service.getStorePackage()
  return res.status(200).json({
    store_package: serializeStorePackage(storePackage),
    unavailable_reason: storePackage ? null : STORE_PACKAGE_MISSING_REASON,
  })
}

export async function POST(
  req: MedusaRequest<SaveShippingStorePackageBody>,
  res: MedusaResponse
) {
  const { result } = await saveShippingStorePackageWorkflow(req.scope).run({
    input: req.validatedBody,
  })
  return res.status(200).json({ store_package: serializeStorePackage(result) })
}
