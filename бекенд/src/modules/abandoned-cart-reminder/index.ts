import { Module } from "@medusajs/framework/utils"

import AbandonedCartReminderModuleService from "./service"

export const ABANDONED_CART_REMINDER_MODULE = "abandonedCartReminder"

export default Module(ABANDONED_CART_REMINDER_MODULE, {
  service: AbandonedCartReminderModuleService,
})
