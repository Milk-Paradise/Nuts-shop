import { Module } from "@medusajs/framework/utils"

import CartMergeOperationModuleService from "./service"

export const CART_MERGE_OPERATION_MODULE = "cartMergeOperation"

export default Module(CART_MERGE_OPERATION_MODULE, {
  service: CartMergeOperationModuleService,
})
