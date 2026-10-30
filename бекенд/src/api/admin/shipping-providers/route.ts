import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { SHIPPING_PROVIDER_REGISTRY_MODULE } from "../../../modules/shipping-provider-registry"
import ShippingProviderRegistryModuleService from "../../../modules/shipping-provider-registry/service"
import setShippingProviderVisibilityWorkflow from "../../../workflows/set-shipping-provider-visibility"
import { isShippingProviderConfigurationReady } from "../../../modules/shipping-provider-registry/readiness"
import { CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY } from "../../../modules/shipping-provider-registry/provider-keys"
import { SetShippingProviderVisibilitySchema } from "./validators"

const SYSTEM_PROVIDER_IDS = new Set(["manual_manual"])

const SUPPORTED_PROVIDERS = [
  { provider_key: CDEK_PROVIDER_KEY, label: "СДЭК", implemented: true },
  { provider_key: OZON_PROVIDER_KEY, label: "Ozon", implemented: true },
] as const

const PROVIDER_LABELS = Object.fromEntries(
  SUPPORTED_PROVIDERS.map((provider) => [provider.provider_key, provider.label])
)

const PROVIDER_SETTINGS_PATHS: Record<string, string> = {
}

type FulfillmentProviderRow = {
  id: string
  is_enabled: boolean
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const registryService: ShippingProviderRegistryModuleService = req.scope.resolve(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )

  const { data: fulfillmentProviders } = await query.graph({
    entity: "fulfillment_provider",
    fields: ["id", "is_enabled"],
  })

  const visibilityRecords = await registryService.listShippingProviderVisibilities()
  const providerConfigs = new Map(await Promise.all(
    SUPPORTED_PROVIDERS.map(async (provider) => [
      provider.provider_key,
      await registryService.getProviderConfig(provider.provider_key),
    ] as const)
  ))
  const isVisibleByProviderKey = new Map(
    visibilityRecords.map((record) => [record.provider_key, record.is_visible])
  )

  const enabledProviderIds = new Set(
    (fulfillmentProviders as FulfillmentProviderRow[])
      .filter((provider) => provider.is_enabled && !SYSTEM_PROVIDER_IDS.has(provider.id))
      .map((provider) => provider.id)
  )
  const shipping_providers = SUPPORTED_PROVIDERS.map((provider) => ({
    ...provider,
    is_visible: provider.implemented
      ? isVisibleByProviderKey.get(provider.provider_key) ?? false
      : false,
    registered: enabledProviderIds.has(provider.provider_key),
    configured: isShippingProviderConfigurationReady(
      provider.provider_key,
      providerConfigs.get(provider.provider_key) ?? null
    ),
    settings_path: PROVIDER_SETTINGS_PATHS[provider.provider_key] ?? null,
  }))

  res.json({ shipping_providers })
}

export async function POST(
  req: MedusaRequest<SetShippingProviderVisibilitySchema>,
  res: MedusaResponse
) {
  const { provider_key, is_visible } = req.validatedBody

  if (!SUPPORTED_PROVIDERS.some((provider) => provider.provider_key === provider_key)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Shipping provider is not supported")
  }

  const { result } = await setShippingProviderVisibilityWorkflow(req.scope).run({
    input: { provider_key, is_visible },
  })

  res.json({
    provider_key: result.provider_key,
    label: PROVIDER_LABELS[result.provider_key] ?? result.provider_key,
    is_visible: result.is_visible,
    settings_path: PROVIDER_SETTINGS_PATHS[result.provider_key] ?? null,
    implemented: true,
  })
}
