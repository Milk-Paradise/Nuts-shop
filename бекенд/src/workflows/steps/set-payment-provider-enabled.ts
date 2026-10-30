import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PAYMENT_PROVIDER_CONFIG_MODULE } from "../../modules/payment-provider-config"
import {
  isRegisteredPaymentProvider,
  verifyPaymentProviderCredentials,
} from "../../modules/payment-provider-config/registry"
import PaymentProviderConfigModuleService from "../../modules/payment-provider-config/service"

export type SetPaymentProviderEnabledStepInput = {
  provider_id: string
  is_enabled: boolean
  actor_id: string
}

type SetPaymentProviderEnabledCompensation = {
  provider_id: string
  previous_is_enabled: boolean
  actor_id: string
  scopes: Array<{
    store_id: string
    region_id: string
    previous_is_enabled: boolean
  }>
}

async function listDefaultPaymentScopes(container: MedusaContainer) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_region_id"],
  })

  return stores.flatMap((store) =>
    store.id && store.default_region_id
      ? [
          {
            store_id: store.id as string,
            region_id: store.default_region_id as string,
          },
        ]
      : []
  )
}

export const setPaymentProviderEnabledStep = createStep(
  "set-payment-provider-enabled",
  async (input: SetPaymentProviderEnabledStepInput, { container }) => {
    if (!isRegisteredPaymentProvider(input.provider_id)) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Payment provider was not found"
      )
    }

    const service = container.resolve(
      PAYMENT_PROVIDER_CONFIG_MODULE
    ) as PaymentProviderConfigModuleService
    const [existing, runtimeConfig] = await Promise.all([
      service.retrieveAdminPaymentProviderConfig(input.provider_id),
      input.is_enabled
        ? service.retrieveRuntimePaymentProviderConfig(input.provider_id)
        : Promise.resolve(null),
    ])

    if (!existing) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Configure the payment provider before changing its status"
      )
    }

    if (
      input.is_enabled &&
      (!existing.shop_id?.trim() || !existing.secret_key_set || !runtimeConfig)
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A provider needs a shop ID and secret key before it can be enabled"
      )
    }

    if (input.is_enabled) {
      await verifyPaymentProviderCredentials(runtimeConfig!)
    }

    const scopes = await listDefaultPaymentScopes(container)
    const scopesWithPreviousState = await Promise.all(
      scopes.map(async (scope) => ({
        ...scope,
        previous_is_enabled: await service.isPaymentProviderAvailable(
          input.provider_id,
          scope
        ),
      }))
    )

    await service.savePaymentProviderConfig({
      provider_id: input.provider_id,
      is_enabled: input.is_enabled,
      actor_id: input.actor_id,
    })
    await Promise.all(
      scopes.map((scope) =>
        service.setPaymentProviderAvailability({
          provider_id: input.provider_id,
          ...scope,
          is_enabled: input.is_enabled,
        })
      )
    )

    const paymentProvider = await service.retrieveAdminPaymentProviderConfig(
      input.provider_id
    )

    return new StepResponse(paymentProvider, {
      provider_id: input.provider_id,
      previous_is_enabled: existing.is_enabled,
      actor_id: input.actor_id,
      scopes: scopesWithPreviousState,
    } satisfies SetPaymentProviderEnabledCompensation)
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }

    const service = container.resolve(
      PAYMENT_PROVIDER_CONFIG_MODULE
    ) as PaymentProviderConfigModuleService

    await service.savePaymentProviderConfig({
      provider_id: compensation.provider_id,
      is_enabled: compensation.previous_is_enabled,
      actor_id: compensation.actor_id,
    })
    await Promise.all(
      compensation.scopes.map((scope) =>
        service.setPaymentProviderAvailability({
          provider_id: compensation.provider_id,
          store_id: scope.store_id,
          region_id: scope.region_id,
          is_enabled: scope.previous_is_enabled,
        })
      )
    )
  }
)
