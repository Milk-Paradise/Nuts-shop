import { MedusaError } from "@medusajs/framework/utils"

import { describeProviderError, normalizeProviderError } from "../errors"
import { formatPaymentStatusErrorLog } from "../../../workflows/steps/check-catalog-payment-status"

describe("нормализация ошибки платёжной системы", () => {
  it("собирает сообщение и код из ответа YooKassa", () => {
    // Ровно та форма, из-за которой в логах было три undefined:
    // объект ответа без полей message/code, которые ждёт ядро Medusa.
    const normalized = normalizeProviderError({
      type: "error",
      id: "req_1",
      code: "invalid_credentials",
      description: "Неверный идентификатор магазина",
    })

    expect(normalized).toBeInstanceOf(MedusaError)
    expect(normalized.message).toContain("Неверный идентификатор магазина")
    expect((normalized as MedusaError).code).toBe("invalid_credentials")
  })

  it("даёт непустое сообщение даже для пустого отказа", () => {
    const normalized = normalizeProviderError({})

    expect(normalized.message.trim()).not.toBe("")
    expect(normalized.message).not.toContain("undefined")
    expect((normalized as MedusaError).code).toBe("provider_error")
  })

  it("не переписывает осмысленные ошибки", () => {
    const original = new MedusaError(MedusaError.Types.NOT_FOUND, "Сессия не найдена")

    expect(normalizeProviderError(original)).toBe(original)

    const plain = new Error("Сеть недоступна")
    expect(normalizeProviderError(plain)).toBe(plain)
  })

  it("описывает нестандартные значения без undefined", () => {
    expect(describeProviderError(undefined).message).not.toContain("undefined")
    expect(describeProviderError(null).message).not.toContain("undefined")
    expect(describeProviderError("таймаут").message).toBe("таймаут")
  })
})

describe("запись об отказе проверки оплаты", () => {
  it("содержит корзину, сессию, код и ответ провайдера", () => {
    const error = normalizeProviderError({
      code: "invalid_credentials",
      description: "Неверный идентификатор магазина",
    })

    const line = formatPaymentStatusErrorLog({
      cart_id: "cart_01KYC",
      payment_session_id: "payses_01ABC",
      error,
    })

    expect(line).toContain("event=payment_status_error")
    expect(line).toContain("cart_id=cart_01KYC")
    expect(line).toContain("payment_session_id=payses_01ABC")
    expect(line).toContain("code=invalid_credentials")
    expect(line).toContain("Неверный идентификатор магазина")
  })

  it("ни одно поле не печатается как undefined", () => {
    const line = formatPaymentStatusErrorLog({
      cart_id: undefined,
      payment_session_id: null,
      error: {},
    })

    expect(line).not.toContain("undefined")
    expect(line).toContain("event=payment_status_error")
  })

  it("не утаскивает в лог ключи платёжной интеграции", () => {
    // providerResponse печатается целиком, поэтому важно, чтобы источником
    // был ответ платёжной системы, а не наша конфигурация с секретами.
    const line = formatPaymentStatusErrorLog({
      cart_id: "cart_1",
      payment_session_id: "payses_1",
      error: normalizeProviderError({ code: "forbidden", description: "нет доступа" }),
    })

    expect(line).not.toMatch(/secret_key|shop_id|secretKey|shopId/i)
  })

  it("переживает ответ, который нельзя сериализовать", () => {
    const circular: any = { code: "boom", description: "циклический" }
    circular.self = circular

    const error = normalizeProviderError(circular)

    expect(() =>
      formatPaymentStatusErrorLog({
        cart_id: "cart_1",
        payment_session_id: "payses_1",
        error,
      })
    ).not.toThrow()
  })
})
