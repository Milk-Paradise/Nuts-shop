import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  CDEK_PROVIDER_KEY,
  isShippingProviderError,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../../../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../../../modules/shipping-provider-registry/service"
import { configureCdekProviderWorkflow } from "../../../../workflows/configure-cdek-provider"
import { serializeCdekProviderConfig } from "../serializers"
import type { SaveCdekProviderConfigurationBody } from "../validators"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const config = await service.getProviderConfig(CDEK_PROVIDER_KEY)
  return res.status(200).json(serializeCdekProviderConfig(config))
}

export async function POST(
  req: MedusaRequest<SaveCdekProviderConfigurationBody>,
  res: MedusaResponse
) {
  try {
    const { result } = await configureCdekProviderWorkflow(req.scope).run({
      input: req.validatedBody,
    })
    return res.status(200).json(serializeCdekProviderConfig(result.config))
  } catch (error) {
    if (isShippingProviderError(error)) {
      return res.status(error.status ?? 502).json({ message: error.message })
    }
    throw error
  }
}
