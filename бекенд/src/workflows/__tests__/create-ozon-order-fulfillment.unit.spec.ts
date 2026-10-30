const run = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => ({
  createOrderFulfillmentWorkflow: jest.fn(() => ({ run })),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createOzonOrderFulfillmentIfNeeded } from "../create-ozon-order-fulfillment"

function containerWithOrder(order: unknown) {
  const locking = {
    execute: jest.fn(async (_key: string, job: () => Promise<unknown>) => job()),
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

describe("createOzonOrderFulfillmentIfNeeded", () => {
  beforeEach(() => run.mockReset())

  it("skips non-Ozon shipping methods", async () => {
    await expect(createOzonOrderFulfillmentIfNeeded(containerWithOrder({
      id: "order_1",
      shipping_methods: [{ data: { cdekData: {} } }],
      items: [{ id: "item_1", quantity: 1, requires_shipping: true }],
      fulfillments: [],
    }), "order_1")).resolves.toEqual({ status: "skipped", reason: "not_ozon" })
    expect(run).not.toHaveBeenCalled()
  })

  it("pins the Ozon shipping option and skips duplicate fulfillment", async () => {
    run.mockResolvedValue({ result: {} })
    await expect(createOzonOrderFulfillmentIfNeeded(containerWithOrder({
      id: "order_1",
      shipping_methods: [{ shipping_option_id: "so_ozon", data: { ozonData: { tariff_code: "pickup" } } }],
      items: [{ id: "item_1", quantity: 2, requires_shipping: true }],
      fulfillments: [],
    }), "order_1")).resolves.toEqual({ status: "created" })
    expect(run).toHaveBeenCalledWith({ input: {
      order_id: "order_1",
      items: [{ id: "item_1", quantity: 2 }],
      shipping_option_id: "so_ozon",
    } })

    await expect(createOzonOrderFulfillmentIfNeeded(containerWithOrder({
      id: "order_1",
      shipping_methods: [{ data: { ozonData: {} } }],
      items: [{ id: "item_1", quantity: 1, requires_shipping: true }],
      fulfillments: [{ provider_id: "ozon_ozon" }],
    }), "order_1")).resolves.toEqual({ status: "skipped", reason: "already_fulfilled" })
  })

  it("returns upstream failure without throwing into the order subscriber", async () => {
    run.mockRejectedValue(new Error("Ozon unavailable"))
    await expect(createOzonOrderFulfillmentIfNeeded(containerWithOrder({
      id: "order_1",
      shipping_methods: [{ data: { ozonData: {} } }],
      items: [{ id: "item_1", quantity: 1, requires_shipping: true }],
      fulfillments: [],
    }), "order_1")).resolves.toEqual({ status: "failed", error: "Ozon unavailable" })
  })
})
