import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  NOTIFICATION_DOMAIN_MODULE,
} from "../../modules/notification-domain"
import NotificationDomainModuleService, {
  SELLER_TELEGRAM_BINDING_ACCOUNT_ID,
} from "../../modules/notification-domain/service"
import { issueTelegramBinding } from "./telegram-binding"

export type SaveSellerEmailInput = { email: string }

export async function saveSellerEmail(
  container: Pick<MedusaContainer, "resolve">,
  input: SaveSellerEmailInput
) {
  const service = container.resolve<NotificationDomainModuleService>(
    NOTIFICATION_DOMAIN_MODULE
  )
  return service.setSellerRecipient("email", input.email)
}

export const saveSellerEmailStep = createStep(
  "save-seller-email",
  async (input: SaveSellerEmailInput, { container }) =>
    new StepResponse(await saveSellerEmail(container, input))
)

export const issueSellerTelegramBindingStep = createStep(
  "issue-seller-telegram-binding",
  async (_, { container }) =>
    new StepResponse(
      await issueTelegramBinding(container, {
        account_id: SELLER_TELEGRAM_BINDING_ACCOUNT_ID,
      })
    )
)

export const disconnectSellerTelegramStep = createStep(
  "disconnect-seller-telegram",
  async (_, { container }) => {
    const service = container.resolve<NotificationDomainModuleService>(
      NOTIFICATION_DOMAIN_MODULE
    )
    return new StepResponse(
      await service.setSellerRecipient("telegram", null)
    )
  }
)
