import type { IPaymentModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { finalizeCatalogOnlinePaymentWorkflow } from "./finalize-catalog-online-payment"

const resolveE2EPaymentSessionStep = createStep(
  "resolve-e2e-payment-session",
  async (input: { payment_id: string }, { container }) => {
    if (!input.payment_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "E2E payment ID is required"
      )
    }
    const payments = container.resolve(Modules.PAYMENT) as IPaymentModuleService
    const sessions = await payments.listPaymentSessions({
      provider_id: "pp_e2e_e2e",
    }, { take: 1_000, order: { created_at: "DESC" } })
    const session = sessions.find(
      (candidate) => candidate.data?.id === input.payment_id
    )
    if (!session) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "E2E payment session was not found"
      )
    }
    return new StepResponse({ session_id: session.id })
  }
)

export const confirmE2EPaymentWorkflow = createWorkflow(
  "confirm-e2e-payment",
  function (input: { payment_id: string }) {
    const session = resolveE2EPaymentSessionStep(input)
    const finalized = finalizeCatalogOnlinePaymentWorkflow.runAsStep({
      input: transform({ session }, ({ session }) => ({
        payment_session_id: session.session_id,
      })),
    })
    return new WorkflowResponse(finalized)
  }
)
