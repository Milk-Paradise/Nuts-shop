import { MedusaService } from "@medusajs/framework/utils"

import OrderFixation from "./models/order-fixation"

class OrderFixationModuleService extends MedusaService({ OrderFixation }) {}

export default OrderFixationModuleService
