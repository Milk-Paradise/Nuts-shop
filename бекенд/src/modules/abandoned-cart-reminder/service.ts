import { MedusaService } from "@medusajs/framework/utils"

import AbandonedCartReminder from "./models/abandoned-cart-reminder"

class AbandonedCartReminderModuleService extends MedusaService({
  AbandonedCartReminder,
}) {}

export default AbandonedCartReminderModuleService
