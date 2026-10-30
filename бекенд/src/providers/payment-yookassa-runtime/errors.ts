import { MedusaError } from "@medusajs/framework/utils"

// 13 сентября 2026 отказ проверки оплаты пришёл в логи так:
//
//   An error occurred in getPaymentStatus: undefined undefined - undefined
//
// Строку печатает ядро Medusa: оно берёт у ошибки message, code и detail,
// а провайдер бросил объект, у которого этих полей нет. Разбирать такой
// инцидент не по чему — а речь о деньгах покупателя.
//
// Приводим всё, что бросает платёжная система, к ошибке с непустым
// сообщением и кодом.

const UNKNOWN_PROVIDER_ERROR = "Платёжная система вернула отказ без описания"

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]

  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }

  if (typeof value === "number") {
    return String(value)
  }

  return null
}

export function describeProviderError(error: unknown): {
  message: string
  code: string
} {
  if (error && typeof error === "object") {
    const source = error as Record<string, unknown>

    // YooKassa отвечает объектом вида { type, id, code, description }.
    const message =
      readString(source, "message") ??
      readString(source, "description") ??
      readString(source, "error_description") ??
      null

    const code =
      readString(source, "code") ??
      readString(source, "type") ??
      readString(source, "statusCode") ??
      null

    if (message || code) {
      return {
        message: message ?? UNKNOWN_PROVIDER_ERROR,
        code: code ?? "provider_error",
      }
    }
  }

  if (typeof error === "string" && error.trim()) {
    return { message: error.trim(), code: "provider_error" }
  }

  return { message: UNKNOWN_PROVIDER_ERROR, code: "provider_error" }
}

export function normalizeProviderError(error: unknown): Error {
  // Ошибки, которые мы бросаем сами, уже осмысленны — не переписываем их.
  if (error instanceof MedusaError) {
    return error
  }

  if (error instanceof Error && typeof error.message === "string" && error.message.trim()) {
    return error
  }

  const { message, code } = describeProviderError(error)
  const normalized = new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    `ЮKassa: ${message}`,
    code
  )

  // Исходный ответ пригодится при разборе, но в лог его кладёт вызывающий код,
  // а не сама ошибка — чтобы не утащить в сообщение лишнее.
  ;(normalized as Error & { providerResponse?: unknown }).providerResponse = error

  return normalized
}
