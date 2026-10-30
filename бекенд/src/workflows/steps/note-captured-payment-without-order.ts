import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type CapturedPaymentWithoutOrderInput = {
  cart_id: string
  payment_id: string | null
}

export function formatCapturedPaymentWithoutOrderLog(
  input: CapturedPaymentWithoutOrderInput
): string {
  return (
    `[catalog] level=ERROR event=payment_captured_without_order ` +
    `cart_id=${input.cart_id || "неизвестна"} ` +
    `payment_id=${input.payment_id || "неизвестен"} ` +
    `message="Оплата подтверждена платёжной системой, но заказ по ней не создан. ` +
    `Найдите платёж в личном кабинете ЮKassa и разберитесь вручную."`
  )
}

// Худший исход этого workflow: платёжная система деньги списала, а заказ не
// появился — шаги создания заказа упали и компенсация их откатила. В логах он
// был неотличим от любого другого отказа.
//
// Сам шаг ничего не делает: вся работа в компенсации, которая выполняется
// ровно тогда, когда откат случился уже ПОСЛЕ подтверждения оплаты.
export const noteCapturedPaymentWithoutOrderStep = createStep(
  "note-captured-payment-without-order",
  async (input: CapturedPaymentWithoutOrderInput) =>
    new StepResponse(void 0, input),
  async (input: CapturedPaymentWithoutOrderInput | undefined, { container }) => {
    if (!input) {
      return
    }

    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error(formatCapturedPaymentWithoutOrderLog(input))
  }
)
