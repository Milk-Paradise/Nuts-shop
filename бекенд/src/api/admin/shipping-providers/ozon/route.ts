import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  OZON_PROVIDER_KEY,
  isShippingProviderError,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../../../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../../../modules/shipping-provider-registry/service"
import { configureOzonProviderWorkflow } from "../../../../workflows/configure-ozon-provider"
import { serializeOzonProviderConfig } from "../serializers"
import type { SaveOzonProviderConfigurationBody } from "../validators"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const config = await service.getProviderConfig(OZON_PROVIDER_KEY)
  return res.status(200).json(serializeOzonProviderConfig(config))
}

export async function POST(
  req: MedusaRequest<SaveOzonProviderConfigurationBody>,
  res: MedusaResponse
) {
  try {
    const { result } = await configureOzonProviderWorkflow(req.scope).run({
      input: req.validatedBody,
    })
    return res.status(200).json(serializeOzonProviderConfig(result.config))
  } catch (error) {
    if (isShippingProviderError(error)) {
      return res.status(error.status ?? 502).json({ message: error.message })
    }
    throw error
  }
}
