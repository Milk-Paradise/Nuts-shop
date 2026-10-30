import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import {
  decryptShippingProviderCredentials,
  type ShippingProviderCredentials,
} from "../modules/shipping-provider-registry/credentials"
import {
  CDEK_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../modules/shipping-provider-registry/service"
import { saveShippingProviderConfigStep } from "./steps/shipping-provider-registry"
import { setShippingProviderVisibilityStep } from "./steps/set-shipping-provider-visibility"
import { ensureCdekShippingOptionsStep } from "./steps/ensure-cdek-shipping-options"

export type CdekProviderConfiguration = {
  sender: {
    city: string
    street: string
    postal_code: string
    contact_name: string
    phone: string
  }
  contract_type: "online_store" | "delivery"
  tariff_codes: number[]
}

export type ConfigureCdekProviderInput = {
  client_id?: string
  client_secret?: string
  configuration: CdekProviderConfiguration
}

export async function resolveAndTestCdekCredentials(
  container: Pick<MedusaContainer, "resolve">,
  input: ConfigureCdekProviderInput
): Promise<ShippingProviderCredentials> {
  const credentials = await resolveCdekCredentials(container, input)
  const service = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  await service.testProviderCredentials(CDEK_PROVIDER_KEY, credentials)
  return credentials
}

export async function resolveCdekCredentials(
  container: Pick<MedusaContainer, "resolve">,
  input: Pick<ConfigureCdekProviderInput, "client_id" | "client_secret">
): Promise<ShippingProviderCredentials> {
  const service = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const existing = await service.getProviderConfig(CDEK_PROVIDER_KEY)
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
      "Укажите client_id и client_secret СДЭК."
    )
  }

  return credentials
}

const testCdekAuthorizationStep = createStep(
  "test-cdek-authorization",
  async (input: ConfigureCdekProviderInput, { container }) =>
    new StepResponse(await resolveAndTestCdekCredentials(container, input))
)

export const configureCdekProviderWorkflow = createWorkflow(
  "configure-cdek-provider",
  function (input: ConfigureCdekProviderInput) {
    const credentials = testCdekAuthorizationStep(input)
    const config = saveShippingProviderConfigStep({
      providerKey: CDEK_PROVIDER_KEY,
      credentials,
      configuration: input.configuration,
    })
    const visibility = setShippingProviderVisibilityStep({
      provider_key: CDEK_PROVIDER_KEY,
      is_visible: true,
    })
    ensureCdekShippingOptionsStep({ enabled: true })
    return new WorkflowResponse({ config, visibility })
  }
)
