import { Module } from "@medusajs/framework/utils"

import PaymentOperationModuleService from "./service"

export const PAYMENT_OPERATION_MODULE = "paymentOperation"

export default Module(PAYMENT_OPERATION_MODULE, {
  service: PaymentOperationModuleService,
})
