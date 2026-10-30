import { MedusaError } from "@medusajs/framework/utils"

import { isMoyskladCredentialsFailure, MoyskladApiError } from "./client"

export type MoyskladOrderSyncErrorClass = "data" | "temporary"

/**
 * Classifies only failures that are safe to stop retrying with certainty.
 * Unknown failures deliberately remain temporary so a recoverable order is
 * not abandoned because of an incomplete classifier.
 */
export function classifyMoyskladOrderSyncError(
  error: unknown
): MoyskladOrderSyncErrorClass {
  if (error instanceof MoyskladApiError && error.status === 400) {
    return "data"
  }

  if (isMoyskladCredentialsFailure(error)) {
    return "data"
  }

  if (
    error instanceof MedusaError &&
    error.type === MedusaError.Types.INVALID_DATA
  ) {
    return "data"
  }

  return "temporary"
}

export function describeMoyskladOrderSyncError(
  classification: MoyskladOrderSyncErrorClass,
  message: string
) {
  return classification === "data"
    ? `Требуется исправление данных, автоматические повторы остановлены: ${message}`
    : `Временная ошибка, автоматический повтор будет выполнен по расписанию: ${message}`
}
