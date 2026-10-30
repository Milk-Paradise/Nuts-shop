import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { prepareCatalogOrderRefund } from "../prepare-catalog-order-refund"

function containerWithOrder(order: unknown) {
  const query = { graph: jest.fn().mockResolvedValue({ data: order ? [order] : [] }) }
  const orderModule = { updateOrders: jest.fn().mockResolvedValue({}) }
  return {
    query,
    container: {
      resolve: jest.fn((key) => {
        if (key === ContainerRegistrationKeys.QUERY) return query
        if (key === "order") return orderModule
        throw new Error(`Unexpected dependency: ${String(key)}`)
      }),
    } as any,
  }
}

it("calculates the refundable balance for registered online providers", async () => {
  const { container, query } = containerWithOrder({
    payment_collections: [
      { payments: [
        {
          id: "payment_1",
          provider_id: "pp_yookassa_yookassa",
          currency_code: "RUB",
          captures: [{ amount: 1000 }, { amount: "500" }, { amount: "bad" }],
          refunds: [{ amount: 200 }, { amount: null }],
        },
        {
          id: "manual",
          provider_id: "pp_system_default",
          captures: [{ amount: 999 }],
        },
        { id: 1, provider_id: "pp_yookassa_yookassa" },
        { id: "missing-provider" },
      ] },
      { payments: null },
      {},
    ],
  })

  await expect(prepareCatalogOrderRefund(container, {
    order_id: "order_1",
    requested_by: "cus_1",
  })).resolves.toEqual({
    order_id: "order_1",
    refunds: [{
      payment_id: "payment_1",
      amount: 1300,
      currency_code: "RUB",
      created_by: "cus_1",
      note: "Возврат при отмене заказа покупателем",
    }],
  })
  expect(query.graph).toHaveBeenCalledWith(expect.objectContaining({
    entity: "order",
    filters: { id: "order_1" },
  }))
})

it("uses RUB by default and keeps a fully refunded zero balance", async () => {
  const { container } = containerWithOrder({
    payment_collections: [{ payments: [{
      id: "payment_1",
      provider_id: "pp_yookassa_yookassa",
      captures: [{ amount: undefined }, { amount: 100 }],
      refunds: [{ amount: "100" }],
    }] }],
  })
  await expect(prepareCatalogOrderRefund(container, { order_id: "order_1" }))
    .resolves.toEqual({
      order_id: "order_1",
      refunds: [expect.objectContaining({ amount: 0, currency_code: "rub", created_by: undefined })],
    })
})

it("drops over-refunded payments and tolerates a missing order graph", async () => {
  const overRefunded = containerWithOrder({
    payment_collections: [{ payments: [{
      id: "payment_1",
      provider_id: "pp_yookassa_yookassa",
      captures: null,
      refunds: [{ amount: 1 }],
    }] }],
  })
  await expect(prepareCatalogOrderRefund(overRefunded.container, { order_id: "order_1" }))
    .resolves.toEqual({ order_id: "order_1", refunds: [] })

  const missing = containerWithOrder(null)
  await expect(prepareCatalogOrderRefund(missing.container, { order_id: "missing" }))
    .resolves.toEqual({ order_id: "missing", refunds: [] })
})

it("allocates a requested partial refund across refundable payments", async () => {
  const { container } = containerWithOrder({
    payment_collections: [{ payments: [
      {
        id: "payment_1",
        provider_id: "pp_yookassa_yookassa",
        currency_code: "RUB",
        captures: [{ amount: 500 }],
        refunds: [],
      },
      {
        id: "payment_2",
        provider_id: "pp_yookassa_yookassa",
        currency_code: "RUB",
        captures: [{ amount: 700 }],
        refunds: [],
      },
    ] }],
  })

  await expect(
    prepareCatalogOrderRefund(container, {
      order_id: "order_1",
      requested_amount: 900,
      refund_request_id: "request_a",
    })
  ).resolves.toEqual({
    order_id: "order_1",
    requested_amount: 900,
    refund_request_id: "request_a",
    refunds: [
      expect.objectContaining({
        payment_id: "payment_1",
        amount: 500,
        idempotency_key: "refund-request:request_a:payment_1",
      }),
      expect.objectContaining({
        payment_id: "payment_2",
        amount: 400,
        idempotency_key: "refund-request:request_a:payment_2",
      }),
    ],
  })
})

it("reuses the persisted allocation after a multi-payment retry", async () => {
  const plan = JSON.stringify({
    request_a: {
      requested_amount: 900,
      refunds: [
        { payment_id: "payment_1", amount: 500, currency_code: "RUB" },
        { payment_id: "payment_2", amount: 400, currency_code: "RUB" },
      ],
    },
  })
  const query = {
    graph: jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ payment_collections: [{ payments: [
          { id: "payment_1", provider_id: "pp_yookassa_yookassa", currency_code: "RUB", captures: [{ amount: 500 }], refunds: [] },
          { id: "payment_2", provider_id: "pp_yookassa_yookassa", currency_code: "RUB", captures: [{ amount: 700 }], refunds: [] },
        ] }] }],
      })
      .mockResolvedValueOnce({
        data: [{
          metadata: { catalog_refund_plans: plan },
          payment_collections: [{ payments: [
            { id: "payment_1", provider_id: "pp_yookassa_yookassa", currency_code: "RUB", captures: [{ amount: 500 }], refunds: [{ amount: 500 }] },
            { id: "payment_2", provider_id: "pp_yookassa_yookassa", currency_code: "RUB", captures: [{ amount: 700 }], refunds: [] },
          ] }],
        }],
      }),
  }
  const container = {
    resolve: jest.fn((key) =>
      key === ContainerRegistrationKeys.QUERY
        ? query
        : { updateOrders: jest.fn().mockResolvedValue({}) }
    ),
  } as any

  await prepareCatalogOrderRefund(container, {
    order_id: "order_1",
    requested_amount: 900,
    refund_request_id: "request_a",
  })
  const retry = await prepareCatalogOrderRefund(container, {
    order_id: "order_1",
    requested_amount: 900,
    refund_request_id: "request_a",
  })

  expect(retry.refunds).toEqual([
    expect.objectContaining({ payment_id: "payment_1", amount: 500 }),
    expect.objectContaining({ payment_id: "payment_2", amount: 400 }),
  ])
})
