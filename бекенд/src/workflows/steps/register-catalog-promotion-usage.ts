import type {
  CampaignBudgetUsageContext,
  IPromotionModuleService,
  UsageComputedActions,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type RegisterCatalogPromotionUsageInput = {
  computedActions: UsageComputedActions[]
  registrationContext: CampaignBudgetUsageContext
}

export const registerCatalogPromotionUsageStep = createStep(
  "register-catalog-promotion-usage",
  async (input: RegisterCatalogPromotionUsageInput, { container }) => {
    if (!input.computedActions.length) {
      return new StepResponse(null, input)
    }

    const promotionService = container.resolve(
      Modules.PROMOTION
    ) as IPromotionModuleService
    await promotionService.registerUsage(
      input.computedActions,
      input.registrationContext
    )

    return new StepResponse(null, input)
  },
  async (input, { container }) => {
    if (!input?.computedActions.length) {
      return
    }

    const promotionService = container.resolve(
      Modules.PROMOTION
    ) as IPromotionModuleService
    await promotionService.revertUsage(
      input.computedActions,
      input.registrationContext
    )
  }
)
