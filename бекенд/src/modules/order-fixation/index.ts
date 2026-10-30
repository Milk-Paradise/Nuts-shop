import { Module } from "@medusajs/framework/utils"

import OrderFixationModuleService from "./service"

export const ORDER_FIXATION_MODULE = "orderFixation"

export default Module(ORDER_FIXATION_MODULE, {
  service: OrderFixationModuleService,
})
