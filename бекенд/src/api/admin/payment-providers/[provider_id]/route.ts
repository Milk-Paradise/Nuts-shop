import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { z } from "zod"

import { PAYMENT_PROVIDER_CONFIG_MODULE } from "../../../../modules/payment-provider-config"
import PaymentProviderConfigModuleService from "../../../../modules/payment-provider-config/service"
import { isRegisteredPaymentProvider } from "../../../../modules/payment-provider-config/registry"
import { AdminSavePaymentProviderConfiguration } from "../validators"

type AdminSavePaymentProviderConfigurationInput = z.infer<
  typeof AdminSavePaymentProviderConfiguration
>

function isBlank(value: string | null | undefined) {
  return !value?.trim()
}

export async function POST(
  req: AuthenticatedMedusaRequest<AdminSavePaymentProviderConfigurationInput>,
  res: MedusaResponse
) {
  const providerId = req.params.provider_id

  if (!isRegisteredPaymentProvider(providerId)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment provider "${providerId}" was not found`
    )
  }

  const paymentProviderConfigService = req.scope.resolve(
    PAYMENT_PROVIDER_CONFIG_MODULE
  ) as PaymentProviderConfigModuleService
  const existing = await paymentProviderConfigService.retrieveAdminPaymentProviderConfig(
    providerId
  )
  const { shop_id, secret_key, mode } = req.validatedBody

  if (!existing && (isBlank(shop_id) || isBlank(secret_key))) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Shop ID and secret key are required when saving a payment provider for the first time"
    )
  }

  await paymentProviderConfigService.savePaymentProviderConfig({
    provider_id: providerId,
    shop_id,
    secret_key,
    mode,
    actor_id: req.auth_context.actor_id,
  })

  const paymentProvider =
    await paymentProviderConfigService.retrieveAdminPaymentProviderConfig(providerId)

  res.json({ payment_provider: paymentProvider })
}
