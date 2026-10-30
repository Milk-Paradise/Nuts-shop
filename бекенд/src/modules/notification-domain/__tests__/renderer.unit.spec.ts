import { loadOrderNotificationData, renderOrderNotification } from "../order-data"
import { renderNotification } from "../renderer"

const order = {
  id: "order_1",
  display_id: 42,
  email: "buyer@example.test",
  currency_code: "rub",
  total: 1250,
  payment_status: "captured",
  items: [
    { title: "Чай", variant_title: "100 г", variant_sku: "TEA", quantity: 2, unit_price: 500 },
    { title: "Мёд", quantity: 1, unit_price: 250 },
  ],
  shipping_address: { city: "Тула", address_1: "ул. Ленина, 1", postal_code: "300000" },
  shipping_methods: [{ name: "Курьер", amount: 200, data: {} }],
  fulfillments: [{ tracking_numbers: ["TRACK-1"] }],
  payment_collections: [{ payments: [{ provider_id: "pp_yookassa", captured_at: "2026-10-07T10:00:00Z" }] }],
}

const template = {
  subject: "Заказ №{{ order_number }}",
  text: "Итого: {{order_total}}. Доставка: {{delivery_address}}. Трек: {{tracking_number}}. Оплата: {{payment_status}}",
  html: "<b>{{ order_number }}</b>",
}

describe("shared notification renderer", () => {
  it("substitutes order composition, total, delivery, tracking, and payment from loaded data", async () => {
    const query = { graph: jest.fn().mockImplementation(({ entity }) => Promise.resolve({
      data: entity === "order" ? [order] : [{ tracking_number: "SHIPMENT-TRACK-1" }],
    })) }

    await expect(renderOrderNotification(query, "order_1", template)).resolves.toEqual({
      subject: "Заказ №42",
      text: "Итого: 1250. Доставка: 300000, Тула, ул. Ленина, 1. Трек: SHIPMENT-TRACK-1. Оплата: captured",
      html: "<b>42</b>",
    })
    expect(query.graph).toHaveBeenCalledWith(expect.objectContaining({
      entity: "order",
      filters: { id: "order_1" },
    }))
    expect(query.graph).toHaveBeenCalledWith({
      entity: "shipping_shipment",
      fields: ["id", "tracking_number"],
      filters: { order_id: "order_1", status: "created" },
    })
  })

  it("propagates a core loading failure and never renders partial content", async () => {
    const failure = new Error("core unavailable")
    const query = { graph: jest.fn().mockRejectedValue(failure) }

    await expect(renderOrderNotification(query, "order_1", template)).rejects.toBe(failure)
  })

  it("gives preview, test, and creation callers identical deterministic content", async () => {
    const query = { graph: jest.fn().mockImplementation(({ entity }) => Promise.resolve({
      data: entity === "order" ? [order] : [],
    })) }
    const loaded = await loadOrderNotificationData(query, "order_1")
    const created = renderNotification(template, loaded)

    order.total = 9999

    expect(renderNotification(template, loaded)).toEqual(created)
    expect(renderNotification(template, loaded)).toEqual(created)
    order.total = 1250
  })

  it("rejects dotted variables instead of silently resolving a non-contract path", () => {
    expect(() => renderNotification({ text: "{{order.missing}}" }, { order: {} }))
      .toThrow("Notification variable 'order.missing' is not supported")
  })

  it("rejects an empty required variable instead of rendering an empty string", () => {
    expect(() => renderNotification(
      { text: "Вернуться: {{checkout_url}}" },
      { checkout_url: null },
      { required: ["checkout_url"] }
    )).toThrow("Notification required variable 'checkout_url' is empty")
  })

  it("escapes loaded values in HTML while keeping template markup", () => {
    expect(renderNotification({ text: "{{name}}", html: "<b>{{name}}</b>" }, { name: "A&B <shop>" }))
      .toEqual({ subject: null, text: "A&B <shop>", html: "<b>A&amp;B &lt;shop&gt;</b>" })
  })

  it("uses a pickup point instead of the shipping address when one is selected", async () => {
    const pickupOrder = {
      ...order,
      shipping_methods: [{ name: "ПВЗ", data: { pickup_point: { id: "pvz_1", name: "ПВЗ 1", address: "Тула, Советская, 2" } } }],
    }
    const query = { graph: jest.fn().mockImplementation(({ entity }) => Promise.resolve({
      data: entity === "order" ? [pickupOrder] : [],
    })) }

    await expect(renderOrderNotification(query, "order_1", { text: "{{delivery_address}}" }))
      .resolves.toMatchObject({ text: "Тула, Советская, 2" })
  })
})
