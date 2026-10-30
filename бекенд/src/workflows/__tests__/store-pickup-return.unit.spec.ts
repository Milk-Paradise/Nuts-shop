import { requestCatalogShippingReturn } from "../request-catalog-shipping-return"

function pickupContainer(metadata: Record<string, unknown>) {
  const registry = {
    listShippingReturnRequests: jest.fn().mockResolvedValue([]),
    createShippingReturnRequests: jest.fn(async (input: Record<string, unknown>) => ({ id: "return-1", ...input })),
    listShippingShipments: jest.fn().mockResolvedValue([]),
  }
  const graph = jest.fn().mockResolvedValue({
    data: [{ id: "order-1", email: "buyer@test", customer: { id: "cus-1" }, status: "pending", metadata }],
  })
  const locking = { execute: jest.fn(async (_key: string, callback: () => Promise<unknown>) => callback()) }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "locking") return locking
      if (key === "query") return { graph }
      if (key === "shippingProviderRegistry") return registry
      throw new Error(`Unexpected dependency: ${key}`)
    }),
  }
  return { container: container as any, registry }
}

describe("store pickup returns", () => {
  it("rejects a return before collection", async () => {
    const { container, registry } = pickupContainer({
      store_pickup: true,
      store_pickup_address: "Магазин",
      store_pickup_hours: "10–19",
    })
    await expect(requestCatalogShippingReturn(container, {
      order_id: "order-1", customer_id: "cus-1", customer_email: "buyer@test",
    })).rejects.toThrow("доступна после выдачи")
    expect(registry.createShippingReturnRequests).not.toHaveBeenCalled()
  })

  it("creates the existing return request after collection without a carrier shipment", async () => {
    const { container, registry } = pickupContainer({
      store_pickup: true,
      store_pickup_address: "Магазин",
      store_pickup_hours: "10–19",
      store_pickup_collected_at: "2026-09-10T10:00:00.000Z",
    })
    await expect(requestCatalogShippingReturn(container, {
      order_id: "order-1", customer_id: "cus-1", customer_email: "buyer@test",
    })).resolves.toMatchObject({ created: true, request: { provider_key: "store_pickup" } })
    expect(registry.listShippingShipments).toHaveBeenCalledWith({
      order_id: "order-1", provider_key: "store_pickup", direction: "forward",
    })
  })

  it("uses the forward shipment for a carrier return", async () => {
    const forward = {
      id: "forward-1",
      provider_key: "cdek_cdek",
      direction: "forward",
      simplified_status: "delivered",
    }
    const registry = {
      listShippingReturnRequests: jest.fn().mockResolvedValue([]),
      createShippingReturnRequests: jest.fn(async (input) => ({ id: "request-1", ...input })),
      listShippingShipments: jest.fn().mockResolvedValue([forward]),
      updateShippingShipments: jest.fn(),
    }
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === "locking") return { execute: async (_key: string, job: () => Promise<unknown>) => job() }
        if (key === "query") return { graph: async () => ({
          data: [{ id: "order-1", email: "buyer@test", customer: { id: "cus-1" }, status: "pending" }],
        }) }
        if (key === "shippingProviderRegistry") return registry
        throw new Error(`Unexpected dependency: ${key}`)
      }),
    }

    await expect(requestCatalogShippingReturn(container as any, {
      order_id: "order-1", customer_id: "cus-1", customer_email: "buyer@test",
    })).resolves.toMatchObject({ created: true })
    expect(registry.listShippingShipments).toHaveBeenCalledWith({
      order_id: "order-1", provider_key: "cdek_cdek", direction: "forward",
    })
    expect(registry.updateShippingShipments).toHaveBeenCalledWith({
      id: "forward-1", simplified_status: "return_in_progress",
    })
  })
})
