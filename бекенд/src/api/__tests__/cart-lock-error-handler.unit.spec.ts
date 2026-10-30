import { MedusaError } from "@medusajs/framework/utils"

import {
  CART_BUSY_ERROR_CODE,
  cartLockErrorHandler,
  isCartLockError,
} from "../cart-lock-error-handler"

function responseStub() {
  const res: any = {
    statusCode: null,
    body: null,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
    headersSent: false,
  }

  return res
}

describe("отказ взятия лока на корзину", () => {
  it("распознаёт ошибку лока по сообщению провайдера", () => {
    expect(
      isCartLockError(new Error('Failed to acquire lock for key "cart_01ABC"'))
    ).toBe(true)
  })

  it("не принимает за отказ лока посторонние ошибки", () => {
    expect(isCartLockError(new Error("Cart not found"))).toBe(false)
    expect(isCartLockError(new MedusaError(MedusaError.Types.NOT_FOUND, "нет"))).toBe(
      false
    )
    expect(isCartLockError("Failed to acquire lock for key")).toBe(false)
  })

  it("отвечает 409, а не 500, когда корзина занята обработкой", () => {
    const res = responseStub()
    const next = jest.fn()

    cartLockErrorHandler()(
      new Error('Failed to acquire lock for key "cart_01KYC83QAHVEASZEY8TMRYSVP8"'),
      {} as any,
      res,
      next
    )

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual(
      expect.objectContaining({ code: CART_BUSY_ERROR_CODE, type: "conflict" })
    )
    expect(res.body.message).toMatch(/обрабатывается/i)
    expect(next).not.toHaveBeenCalled()
  })

  it("находит ошибку лока внутри результата workflow", () => {
    // Workflow отдаёт ошибку шага обёрнутой — без разворачивания опрос
    // статуса оплаты не распознал бы занятую корзину.
    expect(
      isCartLockError({
        errors: [{ error: new Error('Failed to acquire lock for key "cart_01ABC"') }],
      })
    ).toBe(true)
  })

  it("находит ошибку лока в cause", () => {
    const outer: any = new Error("Workflow failed")
    outer.cause = new Error('Failed to acquire lock for key "cart_01ABC"')

    expect(isCartLockError(outer)).toBe(true)
  })

  it("не зацикливается на самоссылающейся ошибке", () => {
    const looping: any = new Error("boom")
    looping.cause = looping

    expect(isCartLockError(looping)).toBe(false)
  })

  it("прочие ошибки уходят в стандартный обработчик, а не в 409", () => {
    const res = responseStub()

    cartLockErrorHandler()(
      new MedusaError(MedusaError.Types.NOT_FOUND, "Cart not found"),
      { path: "/store/carts/x" } as any,
      res,
      jest.fn()
    )

    expect(res.statusCode).not.toBe(409)
  })
})
