// Тот же приём, что в соседних тестах шагов: createStep подменяется, чтобы
// добраться до самих функций прямого пути и компенсации.
jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: string, invoke: any, compensate?: any) =>
    Object.assign(invoke, { compensate }),
  StepResponse: class StepResponse<T, C> {
    constructor(readonly result: T, readonly compensation?: C) {}
  },
}))

import {
  formatCapturedPaymentWithoutOrderLog,
  noteCapturedPaymentWithoutOrderStep,
} from "../note-captured-payment-without-order"

describe("оплачено, но заказ не создан", () => {
  it("запись содержит платёж и корзину — их хватает для разбора в ЮKassa", () => {
    const line = formatCapturedPaymentWithoutOrderLog({
      cart_id: "cart_01KYC",
      payment_id: "pay_01ABC",
    })

    expect(line).toContain("event=payment_captured_without_order")
    expect(line).toContain("cart_id=cart_01KYC")
    expect(line).toContain("payment_id=pay_01ABC")
  })

  it("ни одно поле не печатается как undefined", () => {
    const line = formatCapturedPaymentWithoutOrderLog({
      cart_id: "",
      payment_id: null,
    })

    expect(line).not.toContain("undefined")
    expect(line).not.toContain("null")
  })

  it("на прямом пути молчит, а при откате пишет событие", async () => {
    const logger = { error: jest.fn() }
    const container = { resolve: () => logger }
    const input = { cart_id: "cart_1", payment_id: "pay_1" }

    const invoke = noteCapturedPaymentWithoutOrderStep as any
    const compensate = (noteCapturedPaymentWithoutOrderStep as any).compensate

    await invoke(input, { container })
    expect(logger.error).not.toHaveBeenCalled()

    await compensate(input, { container })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0][0]).toContain(
      "event=payment_captured_without_order"
    )
  })

  it("откат без сохранённых данных не роняет компенсацию", async () => {
    const logger = { error: jest.fn() }
    const container = { resolve: () => logger }
    const compensate = (noteCapturedPaymentWithoutOrderStep as any).compensate

    await expect(compensate(undefined, { container })).resolves.not.toThrow()
    expect(logger.error).not.toHaveBeenCalled()
  })
})
