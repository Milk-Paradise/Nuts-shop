import { Module } from "@medusajs/framework/utils"

import PaymentProviderConfigModuleService from "./service"

export const PAYMENT_PROVIDER_CONFIG_MODULE = "paymentProviderConfig"

export default Module(PAYMENT_PROVIDER_CONFIG_MODULE, {
  service: PaymentProviderConfigModuleService,
})
