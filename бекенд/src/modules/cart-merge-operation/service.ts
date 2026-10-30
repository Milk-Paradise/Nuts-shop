import { MedusaService } from "@medusajs/framework/utils"

import CartMergeOperation from "./models/cart-merge-operation"

class CartMergeOperationModuleService extends MedusaService({
  CartMergeOperation,
}) {}

export default CartMergeOperationModuleService
