import { maskAdminNotificationResponse } from "../mask-response"

function respond(body: unknown) {
  const json = jest.fn().mockReturnThis()
  const res = { json }
  const next = jest.fn()
  maskAdminNotificationResponse({} as never, res as never, next)
  expect(next).toHaveBeenCalledTimes(1)
  expect(res.json(body)).toBe(res)
  expect(json).toHaveBeenCalledTimes(1)
  return json.mock.calls[0][0]
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep)
    Object.freeze(value)
  }
  return value
}

describe("admin notification response masking", () => {
  const data = {
    email: "customer@example.test",
    token: "live-reset-secret",
    nested: [{ token: "nested-secret", url: "/reset-password?token=url-secret&email=a%40mail.test" }],
    telegram: "https://t.me/shop_bot?start=binding-secret",
    subject: "Оплачен заказ №42",
    count: 42,
    enabled: true,
    empty: null,
  }
  const maskedData = {
    ...data,
    token: "•••",
    nested: [{ token: "•••", url: "/reset-password?token=•••&email=a%40mail.test" }],
    telegram: "https://t.me/shop_bot?start=•••",
  }
  const notification = { id: "noti_1", template: "customer-password-reset", data, channel: "email" }

  it.each(["list", "detail"])("masks the %s response without mutating source data", (kind) => {
    const body = freezeDeep(kind === "list"
      ? { notifications: [notification], count: 1, offset: 0, limit: 20 }
      : { notification })
    const snapshot = JSON.stringify(body)
    const result = respond(body)
    expect(result).toEqual(kind === "list"
      ? { ...body, notifications: [{ ...notification, data: maskedData }] }
      : { notification: { ...notification, data: maskedData } })
    expect(JSON.stringify(result)).not.toMatch(/live-reset-secret|nested-secret|url-secret|binding-secret/)
    expect(JSON.stringify(body)).toBe(snapshot)
  })

  it.each([undefined, null, {}, { subject: "Заказ", text: "Оплата получена", url: "/cart?cart_id=cart_1", items: [1, null, "Обычный текст"] }])(
    "preserves notifications without secrets: %j", (ordinaryData) => {
      const record = { id: "order", data: ordinaryData }
      expect(respond({ notifications: [record], count: 1 })).toEqual({ notifications: [record], count: 1 })
      expect(respond({ notification: record })).toEqual({ notification: record })
    }
  )

  it("handles data arrays and string roots", () => {
    expect(respond({ notifications: [
      { data: [{ nested: { token: { secret: "hidden" } } }] },
      { data: "/reset-password?token=root-secret" },
    ] })).toEqual({ notifications: [
      { data: [{ nested: { token: "•••" } }] },
      { data: "/reset-password?token=•••" },
    ] })
  })

  it.each([null, "error", { message: "Error", token: "outside-data" }, { notifications: [], count: 0 }, { notification: { id: "no-data" } }])(
    "preserves other response fields and shapes: %j", (body) => {
      expect(respond(body)).toEqual(body)
    }
  )
})
