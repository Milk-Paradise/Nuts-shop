import { errorHandler } from "@medusajs/framework/http"
import type { ErrorRequestHandler } from "express"

// Medusa сериализует операции над одной корзиной через лок. Когда лок занят,
// провайдер бросает обычный `Error` — не `MedusaError` — и покупатель получает
// `500` на совершенно штатную гонку: 13 сентября 2026 так упало удаление
// товара из корзины, пока страница возврата с оплаты опрашивала статус.
//
// Это не сбой, а «занято, повторите»: 409.
//
// Сообщение ловим по тексту, потому что другого признака у ошибки нет —
// ни кода, ни типа (см. @medusajs/locking, providers/in-memory.js).
const LOCK_ERROR_PATTERN = /Failed to acquire lock for key/i

export const CART_BUSY_ERROR_CODE = "cart_busy"

// Workflow отдаёт наружу не всегда саму ошибку шага: она приходит и обёрнутой
// (`{ errors: [{ error }] }`), и вложенной в `cause`. Проверяем всю цепочку —
// иначе распознавание молча не срабатывало бы именно там, где нужно.
export function isCartLockError(error: unknown, depth = 0): boolean {
  if (!error || depth > 4) {
    return false
  }

  if (typeof (error as Error).message === "string") {
    if (LOCK_ERROR_PATTERN.test((error as Error).message)) {
      return true
    }
  }

  const candidates = [
    (error as { cause?: unknown }).cause,
    ...(Array.isArray((error as { errors?: unknown[] }).errors)
      ? (error as { errors: unknown[] }).errors
      : []),
    (error as { error?: unknown }).error,
  ]

  return candidates.some((candidate) => isCartLockError(candidate, depth + 1))
}

export function cartLockErrorHandler(): ErrorRequestHandler {
  const defaultHandler = errorHandler()

  return (error, req, res, next) => {
    if (!isCartLockError(error)) {
      return defaultHandler(error, req, res, next)
    }

    res.status(409).json({
      code: CART_BUSY_ERROR_CODE,
      type: "conflict",
      message:
        "Корзина сейчас обрабатывается. Повторите действие через несколько секунд.",
    })
  }
}
