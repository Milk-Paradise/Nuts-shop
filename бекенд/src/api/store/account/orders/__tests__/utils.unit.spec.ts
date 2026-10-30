import {
  accountOrderCanCancel,
  accountPaymentStatus,
  classifyOrderBucket,
  listAccountOrders,
  retrieveAccountCustomer,
  retrieveAccountOrder,
} from "../utils"

function order(input: {
  status?: string
  provider_id: string
  captured_amount?: number
  refunded_amount?: number
}) {
  return {
    id: "order_test",
    status: input.status ?? "pending",
    payment_collections: [
      {
        captured_amount: input.captured_amount ?? 1500,
        refunded_amount: input.refunded_amount ?? 0,
        payments: [
          {
            provider_id: input.provider_id,
            amount: 1500,
            captured_at: "2026-07-13T12:00:00.000Z",
            refunds: [],
          },
        ],
      },
    ],
  }
}

describe("accountPaymentStatus", () => {
  it("does not change manual-order presentation", () => {
    expect(
      accountPaymentStatus(order({ provider_id: "pp_system_default" }))
    ).toBeNull()
  })

  it("shows a captured online payment as paid", () => {
    expect(
      accountPaymentStatus(order({ provider_id: "pp_yookassa_yookassa" }))
    ).toBe("paid")
  })

  it("shows a canceled online order as awaiting its refund", () => {
    expect(
      accountPaymentStatus(
        order({
          status: "canceled",
          provider_id: "pp_yookassa_yookassa",
        })
      )
    ).toBe("refund_pending")
  })

  it("prioritizes a completed full refund over the order status", () => {
    expect(
      accountPaymentStatus(
        order({
          status: "canceled",
          provider_id: "pp_yookassa_yookassa",
          refunded_amount: 1500,
        })
      )
    ).toBe("refunded")
  })
})

describe("accountOrderCanCancel", () => {
  it("allows cancellation when there are no fulfillments", () => {
    expect(accountOrderCanCancel({ status: "pending", fulfillments: [] })).toBe(
      true
    )
  })

  it("blocks cancellation once an unmanaged fulfillment is active", () => {
    expect(
      accountOrderCanCancel({
        status: "pending",
        fulfillments: [{ id: "ful_test", provider_id: "manual_manual" }],
      })
    ).toBe(false)
  })

  it("ignores fulfillments already canceled", () => {
    expect(
      accountOrderCanCancel({
        status: "pending",
        fulfillments: [
          {
            id: "ful_test",
            provider_id: "manual_manual",
            canceled_at: "2024-01-01",
          },
        ],
      })
    ).toBe(true)
  })

  it("does not offer cancellation for terminal order statuses", () => {
    expect(accountOrderCanCancel({ status: "completed" })).toBe(false)
    expect(accountOrderCanCancel({ status: "canceled" })).toBe(false)
    expect(
      accountOrderCanCancel({
        status: "pending",
        canceled_at: "2026-10-27",
      })
    ).toBe(false)
  })
})

describe("classifyOrderBucket", () => {
  it("places canceled orders in history even when status is not refreshed", () => {
    expect(
      classifyOrderBucket({
        status: "pending",
        canceled_at: "2026-10-27T12:00:00.000Z",
      })
    ).toBe("history")
  })
})

function richOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    display_id: "42",
    status: "pending",
    fulfillment_status: "not_fulfilled",
    email: " Buyer@Example.Test ",
    customer_id: "cus-1",
    currency_code: "rub",
    total: "1700",
    subtotal: 1500,
    item_total: 1500,
    shipping_total: 200,
    tax_total: 0,
    created_at: new Date("2026-01-02T00:00:00Z"),
    updated_at: "2026-01-03T00:00:00Z",
    metadata: {
      checkout_contact_name: "Metadata Name",
      checkout_contact_phone: "+7000",
      checkout_address_city: "Metadata City",
      checkout_comment: " Comment ",
    },
    shipping_address: { first_name: " Address Name ", phone: " +7999 ", city: " Moscow ", address_1: " Street ", address_2: " Apt ", country_code: " ru " },
    items: [
      { id: "item-1", product_title: " Product ", title: " Line ", variant_title: " Red ", variant_sku: " SKU ", quantity: 2, unit_price: "500", subtotal: "1000" },
      { id: "item-2", title: "Second", detail: { raw_quantity: "2" }, unit_price: 250, total: null },
      { title: "missing id" },
    ],
    fulfillments: [],
    payment_collections: [{
      captured_amount: 0,
      refunded_amount: 0,
      payments: [{ provider_id: "pp_yookassa_yookassa", amount: "1700", captured_at: "2026-01-02", refunds: [] }],
    }],
    ...overrides,
  }
}

function orderScope(responses: Record<string, any[]>, registryOverrides: Record<string, unknown> = {}) {
  const graph = jest.fn(async ({ entity, filters }) => {
    if (entity === "customer") return { data: responses.customer ?? [] }
    if (entity === "order" && "id" in (filters ?? {})) return { data: responses.detail ?? [] }
    if (entity === "order" && "email" in (filters ?? {})) return { data: responses.email ?? [] }
    return { data: responses.customerOrders ?? [] }
  })
  const registry = {
    listShippingShipments: jest.fn().mockResolvedValue([]),
    listShippingReturnRequests: jest.fn().mockResolvedValue([]),
    ...registryOverrides,
  }
  const scope = { resolve: jest.fn((key: string) => key === "query" ? { graph } : registry) }
  return { scope: scope as any, graph, registry }
}

describe("account order read model", () => {
  it("retrieves the authenticated customer and rejects incomplete records", async () => {
    const found = orderScope({ customer: [{ id: "cus-1", email: "buyer@example.test" }] })
    await expect(retrieveAccountCustomer({ auth_context: { actor_id: "cus-1" }, scope: found.scope } as any)).resolves.toEqual({ id: "cus-1", email: "buyer@example.test" })

    const missing = orderScope({ customer: [{ id: "cus-1" }] })
    await expect(retrieveAccountCustomer({ auth_context: { actor_id: "cus-1" }, scope: missing.scope } as any)).rejects.toThrow("was not found")
  })

  it("deduplicates email/customer matches, filters buckets, sorts and paginates", async () => {
    const newest = richOrder({ id: "new", created_at: "2026-01-03", customer_id: null, customer: { id: "cus-1" } })
    const old = richOrder({ id: "old", created_at: "bad-date", status: "canceled" })
    const inaccessible = richOrder({ id: "foreign", customer_id: "other", email: "other@example.test" })
    const { scope } = orderScope({
      email: [newest, old, inaccessible],
      customerOrders: [newest],
    })
    const result = await listAccountOrders(scope, { id: "cus-1", email: "BUYER@example.test" }, { filter: "in_progress", offset: 0, limit: 1 })
    expect(result.count).toBe(1)
    expect(result.orders).toHaveLength(1)
    expect(result.orders[0]).toMatchObject({
      id: "new",
      display_id: 42,
      email: "buyer@example.test",
      item_count: 4,
      payment_status: "paid",
      contact: { name: "Address Name", phone: "+7999" },
      address: { city: "Moscow", address_1: "Street" },
      comment: "Comment",
    })
    expect(result.orders[0]).not.toHaveProperty("items")
  })

  it("serializes fallback values and aggregate refund amounts", async () => {
    const source = richOrder({
      display_id: null,
      status: null,
      fulfillment_status: null,
      email: null,
      currency_code: null,
      total: "bad",
      shipping_address: null,
      created_at: "",
      updated_at: null,
      items: [{ id: "item", quantity: -1, unit_price: "bad", title: null }],
      payment_collections: [{ captured_amount: 100, refunded_amount: 100, payments: [{ provider_id: "pp_yookassa_yookassa" }] }],
    })
    const { scope } = orderScope({ email: [], customerOrders: [source] })
    const result = await listAccountOrders(scope, { id: "cus-1", email: "" })
    expect(result.orders[0]).toMatchObject({
      status: "pending", fulfillment_status: "not_fulfilled", email: "", currency_code: "rub",
      total: 0, created_at: null, updated_at: null, payment_status: "refunded",
      contact: { name: "Metadata Name", phone: "+7000" }, address: { city: "Metadata City" },
      item_count: 1,
    })
  })

  it("retrieves order details by customer id or normalized email", async () => {
    const { scope } = orderScope({ detail: [richOrder({ customer_id: null, customer: null })] })
    const result = await retrieveAccountOrder(scope, { id: "other", email: "buyer@example.test" }, "order-1")
    expect(result.items).toHaveLength(2)
    expect(result.items?.[1]).toMatchObject({ product_title: "Second", quantity: 2, total: 500 })
  })

  it("hides foreign orders and records delivery return/cancellation state", async () => {
    const hidden = orderScope({ detail: [richOrder({ customer_id: "other", email: "other@test" })] })
    await expect(retrieveAccountOrder(hidden.scope, { id: "cus-1", email: "buyer@test" }, "order-1")).rejects.toThrow("was not found")

    const pendingReturn = {
      id: "return-1", status: "pending", reason: "damaged",
      return_tracking_number: "TRACK", return_delivery_status: "return_in_progress",
    }
    const active = orderScope(
      { detail: [richOrder()] },
      {
        listShippingShipments: jest.fn().mockResolvedValue([{ simplified_status: "preparing" }]),
        listShippingReturnRequests: jest.fn().mockResolvedValue([pendingReturn]),
      }
    )
    const result = await retrieveAccountOrder(active.scope, { id: "cus-1", email: "buyer@test" }, "order-1")
    expect(result.can_cancel).toBe(false)
    expect(result.can_return).toBe(false)
    expect(result.return_request).toEqual(pendingReturn)

    const rejected = orderScope(
      { detail: [richOrder()] },
      {
        listShippingShipments: jest.fn().mockResolvedValue([{ simplified_status: "delivered" }]),
        listShippingReturnRequests: jest.fn().mockResolvedValue([{ ...pendingReturn, status: "rejected" }]),
      }
    )
    await expect(retrieveAccountOrder(rejected.scope, { id: "cus-1", email: "buyer@test" }, "order-1")).resolves.toMatchObject({ can_return: true })
  })

  it("uses the latest active forward shipment regardless of carrier", async () => {
    const ozon = orderScope(
      { detail: [richOrder()] },
      {
        listShippingShipments: jest.fn().mockResolvedValue([
          { provider_key: "ozon_ozon", simplified_status: "delivered" },
        ]),
      }
    )

    await expect(
      retrieveAccountOrder(ozon.scope, { id: "cus-1", email: "buyer@test" }, "order-1")
    ).resolves.toMatchObject({ can_cancel: false, can_return: true })
    expect(ozon.registry.listShippingShipments).toHaveBeenCalledWith(
      {
        order_id: "order-1",
        direction: "forward",
        simplified_status: { $ne: "cancelled" },
      },
      { order: { created_at: "DESC" }, take: 1 }
    )
  })

  // Filter, sort and page are three independent knobs: turning one must not
  // move the others. The whole set is ordered and filtered first, and only the
  // result of that is cut into pages — so `count` describes the view, not the page.
  describe("filter, sort and paging are independent", () => {
    const mixed = [
      richOrder({ id: "a", created_at: "2026-01-01T00:00:00Z" }),
      richOrder({ id: "b", created_at: "2026-01-02T00:00:00Z", status: "canceled" }),
      richOrder({ id: "c", created_at: "2026-01-03T00:00:00Z" }),
      richOrder({ id: "d", created_at: "2026-01-04T00:00:00Z", fulfillment_status: "delivered" }),
      richOrder({ id: "e", created_at: "2026-01-05T00:00:00Z" }),
    ]
    const customer = { id: "cus-1", email: "buyer@example.test" }

    async function list(options: Record<string, unknown>) {
      const { scope } = orderScope({ email: mixed, customerOrders: [] })
      const result = await listAccountOrders(scope, customer, options as any)
      return { ids: result.orders.map((order) => order.id), count: result.count }
    }

    it("defaults to every order, newest first", async () => {
      expect(await list({})).toEqual({ ids: ["e", "d", "c", "b", "a"], count: 5 })
    })

    it("pages the unfiltered view like any other view", async () => {
      expect(await list({ filter: "all", limit: 2, offset: 0 })).toEqual({ ids: ["e", "d"], count: 5 })
      expect(await list({ filter: "all", limit: 2, offset: 4 })).toEqual({ ids: ["a"], count: 5 })
    })

    it("flips the order without touching the filter or the page size", async () => {
      expect(await list({ sort: "created_at_asc", limit: 2 })).toEqual({ ids: ["a", "b"], count: 5 })
      expect(await list({ filter: "in_progress", sort: "created_at_asc" })).toEqual({ ids: ["a", "c", "e"], count: 3 })
    })

    it("counts the filtered view, not the page", async () => {
      expect(await list({ filter: "in_progress", limit: 2, offset: 0 })).toEqual({ ids: ["e", "c"], count: 3 })
      expect(await list({ filter: "in_progress", limit: 2, offset: 2 })).toEqual({ ids: ["a"], count: 3 })
      expect(await list({ filter: "history" })).toEqual({ ids: ["d", "b"], count: 2 })
      // All three knobs at once: cutting the page before filtering would hand
      // back "b" here, and ignoring the sort would hand back "b" as well.
      expect(await list({ filter: "history", sort: "created_at_asc", limit: 1, offset: 1 })).toEqual({ ids: ["d"], count: 2 })
    })
  })

  it("rejects malformed order records without ids", async () => {
    const { scope } = orderScope({ email: [{ email: "buyer@test" }], customerOrders: [] })
    await expect(listAccountOrders(scope, { id: "cus", email: "buyer@test" })).resolves.toEqual({ orders: [], count: 0 })
  })
})
