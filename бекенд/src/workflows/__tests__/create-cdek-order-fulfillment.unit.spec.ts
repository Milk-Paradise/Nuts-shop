const run = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => ({
  createOrderFulfillmentWorkflow: jest.fn(() => ({ run })),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createCdekOrderFulfillmentIfNeeded } from "../create-cdek-order-fulfillment"

function containerWithOrder(order: unknown) {
  let tail = Promise.resolve()
  const locking = {
    execute: jest.fn(async (_key: string, job: () => Promise<unknown>) => {
      const previous = tail
      let release!: () => void
      tail = new Promise<void>((resolve) => { release = resolve })
      await previous
      try { return await job() } finally { release() }
    }),
  }
  return {
    resolve: jest.fn((key: string) => {
      if (key === Modules.LOCKING) return locking
      if (key === ContainerRegistrationKeys.QUERY) {
        return { graph: jest.fn().mockResolvedValue({ data: [order] }) }
      }
      throw new Error(`Unexpected dependency: ${key}`)
    }),
  } as any
}

describe("createCdekOrderFulfillmentIfNeeded", () => {
  beforeEach(() => run.mockReset())

  it("does not touch non-CDEK or manual orders", async () => {
    const result = await createCdekOrderFulfillmentIfNeeded(containerWithOrder({
      id: "order_1",
      shipping_methods: [{ data: { ozonData: {} } }],
      items: [{ id: "item_1", quantity: 1, requires_shipping: true }],
      fulfillments: [],
    }), "order_1")

    expect(result).toEqual({ status: "skipped", reason: "not_cdek" })
    expect(run).not.toHaveBeenCalled()
  })

  it("pins the selected CDEK shipping option", async () => {
    run.mockResolvedValue({ result: {} })
    const result = await createCdekOrderFulfillmentIfNeeded(containerWithOrder({
      id: "order_1",
      shipping_methods: [
        { shipping_option_id: "so_manual", data: {} },
        { shipping_option_id: "so_cdek", data: { cdekData: { tariff_code: 136 } } },
      ],
      items: [{ id: "item_1", quantity: 2, requires_shipping: true }],
      fulfillments: [],
    }), "order_1")

    expect(result).toEqual({ status: "created" })
    expect(run).toHaveBeenCalledWith({
      input: {
        order_id: "order_1",
        items: [{ id: "item_1", quantity: 2 }],
        shipping_option_id: "so_cdek",
      },
    })
  })

  it("does not create a second Medusa fulfillment", async () => {
    const result = await createCdekOrderFulfillmentIfNeeded(containerWithOrder({
      id: "order_1",
      shipping_methods: [{ shipping_option_id: "so_cdek", data: { cdekData: {} } }],
      items: [{ id: "item_1", quantity: 1, requires_shipping: true }],
      fulfillments: [{ provider_id: "cdek_cdek" }],
    }), "order_1")

    expect(result).toEqual({ status: "skipped", reason: "already_fulfilled" })
    expect(run).not.toHaveBeenCalled()
  })

  it("returns a failure without throwing into order.placed", async () => {
    run.mockRejectedValue(new Error("CDEK unavailable"))
    const result = await createCdekOrderFulfillmentIfNeeded(containerWithOrder({
      id: "order_1",
      shipping_methods: [{ shipping_option_id: "so_cdek", data: { cdekData: {} } }],
      items: [{ id: "item_1", quantity: 1, requires_shipping: true }],
      fulfillments: [],
    }), "order_1")

    expect(result).toEqual({ status: "failed", error: "CDEK unavailable" })
  })

  it("serializes concurrent retries around the query and core workflow", async () => {
    const order: any = {
      id: "order_1",
      shipping_methods: [{ shipping_option_id: "so_cdek", data: { cdekData: {} } }],
      items: [{ id: "item_1", quantity: 1, requires_shipping: true }],
      fulfillments: [],
    }
    run.mockImplementation(async () => {
      await Promise.resolve()
      order.fulfillments = [{ provider_id: "cdek_cdek" }]
      return { result: {} }
    })
    const container = containerWithOrder(order)

    const results = await Promise.all([
      createCdekOrderFulfillmentIfNeeded(container, "order_1"),
      createCdekOrderFulfillmentIfNeeded(container, "order_1"),
    ])

    expect(results).toEqual([
      { status: "created" },
      { status: "skipped", reason: "already_fulfilled" },
    ])
    expect(run).toHaveBeenCalledTimes(1)
  })
})
