import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import PaymentProviderConfigModuleService from "../../../modules/payment-provider-config/service"
import { PAYMENT_PROVIDER_CONFIG_MODULE } from "../../../modules/payment-provider-config"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const paymentProviderConfigService = req.scope.resolve(
    PAYMENT_PROVIDER_CONFIG_MODULE
  ) as PaymentProviderConfigModuleService
  const paymentProviders =
    await paymentProviderConfigService.listAdminPaymentProviders()

  res.json({ payment_providers: paymentProviders })
}
