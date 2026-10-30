import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"

import { MedusaError } from "@medusajs/framework/utils"

import {
  isShippingProviderError,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../../../../modules/shipping-provider-registry"
import { STORE_PACKAGE_MISSING_REASON } from "../../../../../modules/shipping-provider-registry/store-package"
import type ShippingProviderRegistryModuleService from "../../../../../modules/shipping-provider-registry/service"
import { resolveCdekCredentials } from "../../../../../workflows/configure-cdek-provider"
import type { ListCdekTariffsBody } from "../../validators"

export async function listCdekTariffs(
  container: Pick<MedusaContainer, "resolve">,
  input: ListCdekTariffsBody
) {
  const service = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const storePackage = await service.getStorePackage()
  if (!storePackage) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, STORE_PACKAGE_MISSING_REASON)
  }

  const credentials = await resolveCdekCredentials(container, input)
  return service.listCdekTariffs(credentials, {
    contract_type: input.contract_type,
    sender: input.sender,
    package: {
      weight_grams: storePackage.weight_grams,
      length_mm: storePackage.length_mm,
      width_mm: storePackage.width_mm,
      height_mm: storePackage.height_mm,
    },
  })
}

export async function POST(
  req: MedusaRequest<ListCdekTariffsBody>,
  res: MedusaResponse
) {
  try {
    const tariffs = await listCdekTariffs(req.scope, req.validatedBody)
    return res.status(200).json({ tariffs })
  } catch (error) {
    if (isShippingProviderError(error)) {
      return res.status(error.status ?? 502).json({ message: error.message })
    }
    throw error
  }
}
