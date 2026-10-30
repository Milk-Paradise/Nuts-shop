import { GET } from "../route"

function request(query: Record<string, unknown>, records: unknown[] = [], count = 0) {
  const service = {
    listAndCountNotificationMessages: jest.fn().mockResolvedValue([records, count]),
    listNotificationAttempts: jest.fn().mockResolvedValue([]),
  }
  return {
    service,
    req: {
      validatedQuery: { limit: 20, offset: 0, show_tests: false, ...query },
      scope: { resolve: jest.fn().mockReturnValue(service) },
    },
    res: { status: jest.fn().mockReturnThis(), json: jest.fn() },
  }
}

describe("GET /admin/notification-journal", () => {
  it.each([{}, { order_id: "order_42" }])("masks journal and order widget responses: %j", async (query) => {
    const secretUrl = "https://shop.test/reset-password?token=live-secret&email=a%40mail.test"
    const maskedUrl = "https://shop.test/reset-password?token=•••&email=a%40mail.test"
    const content = { subject: `Reset ${secretUrl}`, text: `Open ${secretUrl}` }
    const records = [
      { id: "reset", recipient: "a@mail.test", event_key: "reset:order_42", content },
      { id: "binding", recipient: "a@mail.test", event_key: "binding:order_42", content: { body: "https://t.me/catalog_bot?start=live-binding" } },
      { id: "order", recipient: "a@mail.test", event_key: "order:order_42", content: { subject: "Заказ оплачен", text: "Заказ №42: https://shop.test/cart?cart_id=cart_42" } },
      { id: "empty", recipient: "a@mail.test", event_key: "empty", content: {} },
    ]
    const context = request(query, records, records.length)

    await GET(context.req as never, context.res as never)

    const response = context.res.json.mock.calls[0][0]
    expect(response.notifications).toEqual([
      expect.objectContaining({ subject: `Reset ${maskedUrl}`, text: `Open ${maskedUrl}` }),
      expect.objectContaining({ text: "https://t.me/catalog_bot?start=•••" }),
      expect.objectContaining(records[2].content),
      expect.objectContaining({ subject: null, text: null }),
    ])
    expect(JSON.stringify(response)).not.toContain("live-secret")
    expect(JSON.stringify(response)).not.toContain("live-binding")
    expect(content).toEqual({ subject: `Reset ${secretUrl}`, text: `Open ${secretUrl}` })
  })

  it("filters by state", async () => {
    const context = request({ state: "retry_pending" })

    await GET(context.req as never, context.res as never)

    expect(context.service.listAndCountNotificationMessages).toHaveBeenCalledWith(
      { state: "retry_pending", is_test: false },
      { take: 20, skip: 0, order: { created_at: "DESC" } }
    )
  })

  it("limits the order widget to its order and excludes tests", async () => {
    const context = request({ order_id: "order_42", show_tests: true })

    await GET(context.req as never, context.res as never)

    expect(context.service.listAndCountNotificationMessages).toHaveBeenCalledWith(
      { event_key: { $like: "%:order_42%" }, is_test: false },
      expect.any(Object)
    )
  })

  it("shows tests only when explicitly requested by the journal", async () => {
    const hidden = request({})
    const visible = request({ show_tests: true })

    await GET(hidden.req as never, hidden.res as never)
    await GET(visible.req as never, visible.res as never)

    expect(hidden.service.listAndCountNotificationMessages).toHaveBeenCalledWith(
      { is_test: false },
      expect.any(Object)
    )
    expect(visible.service.listAndCountNotificationMessages).toHaveBeenCalledWith(
      {},
      expect.any(Object)
    )
  })
})
