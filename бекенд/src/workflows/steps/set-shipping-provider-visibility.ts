import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  CDEK_PROVIDER_KEY,
  OZON_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../modules/shipping-provider-registry"
import { MedusaError } from "@medusajs/framework/utils"
import ShippingProviderRegistryModuleService from "../../modules/shipping-provider-registry/service"
import { isShippingProviderConfigurationReady } from "../../modules/shipping-provider-registry/readiness"

type Input = {
  provider_key: string
  is_visible: boolean
}

type CompensationInput = {
  id: string
  existed: boolean
  previous_is_visible: boolean | null
}

export { isShippingProviderConfigurationReady }
export const hasVerifiedCdekConfiguration = (config: Parameters<typeof isShippingProviderConfigurationReady>[1]) =>
  isShippingProviderConfigurationReady(CDEK_PROVIDER_KEY, config)

export const setShippingProviderVisibilityStep = createStep(
  "set-shipping-provider-visibility",
  async (input: Input, { container }) => {
    if (input.provider_key !== CDEK_PROVIDER_KEY && input.provider_key !== OZON_PROVIDER_KEY) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Shipping provider is not supported")
    }

    const registryService: ShippingProviderRegistryModuleService = container.resolve(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )

    const [existing] = await registryService.listShippingProviderVisibilities({
      provider_key: input.provider_key,
    })

    if (input.is_visible) {
      const config = await registryService.getProviderConfig(input.provider_key)
      if (!isShippingProviderConfigurationReady(input.provider_key, config)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_ARGUMENT,
          "Сначала настройте и проверьте реквизиты перевозчика."
        )
      }
    }

    const record = existing
      ? await registryService.updateShippingProviderVisibilities({
          id: existing.id,
          is_visible: input.is_visible,
        })
      : await registryService.createShippingProviderVisibilities({
          provider_key: input.provider_key,
          is_visible: input.is_visible,
        })

    return new StepResponse(record, {
      id: record.id,
      existed: !!existing,
      previous_is_visible: existing?.is_visible ?? null,
    })
  },
  async (compensationInput: CompensationInput | undefined, { container }) => {
    if (!compensationInput) {
      return
    }

    const registryService: ShippingProviderRegistryModuleService = container.resolve(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )

    if (compensationInput.existed) {
      await registryService.updateShippingProviderVisibilities({
        id: compensationInput.id,
        is_visible: compensationInput.previous_is_visible!,
      })
    } else {
      await registryService.deleteShippingProviderVisibilities(compensationInput.id)
    }
  }
)
