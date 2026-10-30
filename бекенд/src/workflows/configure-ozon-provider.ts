import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  OZON_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../modules/shipping-provider-registry"
import {
  decryptShippingProviderCredentials,
  type ShippingProviderCredentials,
} from "../modules/shipping-provider-registry/credentials"
import type ShippingProviderRegistryModuleService from "../modules/shipping-provider-registry/service"
import { saveShippingProviderConfigStep } from "./steps/shipping-provider-registry"
import { setShippingProviderVisibilityStep } from "./steps/set-shipping-provider-visibility"

export type OzonProviderConfiguration = {
  sender?: { city?: string; postal_code?: string }
  max_weight_grams?: number
  pickup_point_cache_ttl_seconds?: number
}

export type ConfigureOzonProviderInput = {
  client_id?: string
  client_secret?: string
  configuration: OzonProviderConfiguration
}

export async function resolveOzonCredentials(
  container: Pick<MedusaContainer, "resolve">,
  input: Pick<ConfigureOzonProviderInput, "client_id" | "client_secret">
): Promise<ShippingProviderCredentials> {
  const service = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const existing = await service.getProviderConfig(OZON_PROVIDER_KEY)
  const stored = existing?.encrypted_credentials
    ? decryptShippingProviderCredentials(existing.encrypted_credentials)
    : null
  const credentials = {
    client_id: input.client_id?.trim() || stored?.client_id || "",
    client_secret: input.client_secret || stored?.client_secret || "",
  }
  if (!credentials.client_id || !credentials.client_secret) {
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      "Укажите client_id и client_secret Ozon."
    )
  }
  return credentials
}

export async function resolveAndTestOzonCredentials(
  container: Pick<MedusaContainer, "resolve">,
  input: ConfigureOzonProviderInput
): Promise<ShippingProviderCredentials> {
  const credentials = await resolveOzonCredentials(container, input)
  const service = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  await service.testProviderCredentials(OZON_PROVIDER_KEY, credentials)
  return credentials
}

const testOzonAuthorizationStep = createStep(
  "test-ozon-authorization",
  async (input: ConfigureOzonProviderInput, { container }) =>
    new StepResponse(await resolveAndTestOzonCredentials(container, input))
)

export const configureOzonProviderWorkflow = createWorkflow(
  "configure-ozon-provider",
  function (input: ConfigureOzonProviderInput) {
    const credentials = testOzonAuthorizationStep(input)
    const config = saveShippingProviderConfigStep({
      providerKey: OZON_PROVIDER_KEY,
      credentials,
      configuration: input.configuration,
    })
    const visibility = setShippingProviderVisibilityStep({
      provider_key: OZON_PROVIDER_KEY,
      is_visible: true,
    })
    return new WorkflowResponse({ config, visibility })
  }
)
