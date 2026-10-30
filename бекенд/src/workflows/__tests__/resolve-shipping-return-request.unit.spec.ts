import { resolveShippingReturnRequest } from "../resolve-shipping-return-request"

function harness() {
  const request: any = {
    id: "ret_1",
    order_id: "order_1",
    provider_key: "cdek_cdek",
    status: "pending",
    previous_delivery_status: "delivered",
    return_provider_shipment_id: null,
  }
  const shipment: any = {
    id: "ship_1",
    order_id: "order_1",
    direction: "forward",
    provider_shipment_id: "direct-uuid",
    simplified_status: "return_in_progress",
  }
  let returnShipment: any = null
  const service = {
    retrieveShippingReturnRequest: jest.fn(async () => request),
    updateShippingReturnRequests: jest.fn(async (input) => Object.assign(request, input)),
    listShippingShipments: jest.fn().mockResolvedValue([shipment]),
    claimShippingShipment: jest.fn(async (input) => {
      returnShipment = { id: "return_ship_1", ...input }
      return { shipment: returnShipment, created: true }
    }),
    updateShippingShipments: jest.fn(async (input) => {
      const target = input.id === shipment.id ? shipment : returnShipment
      return Object.assign(target, input)
    }),
    createCarrierReturnShipment: jest.fn(async (providerKey) =>
      providerKey === "cdek_cdek"
        ? {
            id: "return-uuid",
            tracking_number: "return-track",
            register_shipment: true,
          }
        : {
            id: "ozon-return-uuid",
            tracking_number: null,
            register_shipment: false,
          }
    ),
  }
  const query = {
    graph: jest.fn().mockResolvedValue({
      data: [{
        id: "order_1",
        email: "buyer@test.com",
        display_id: 42,
        shipping_address: {
          city: "Тула",
          postal_code: "300000",
          address_1: "Ленина, 1",
          phone: "+79991111111",
        },
        items: [{ id: "item_1", title: "Краска", variant_sku: "SKU-1", quantity: 1 }],
        shipping_methods: [{ data: { cdekData: { tariff_code: 136 } } }],
      }],
    }),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "shippingProviderRegistry") return service
      if (key === "locking") return { execute: (_key, callback) => callback() }
      if (key === "query") return query
      throw new Error(`Unexpected dependency: ${key}`)
    }),
  } as any
  return { container, request, shipment, service, query }
}

describe("resolveShippingReturnRequest", () => {
  it("restores the exact pre-request delivery status when rejected", async () => {
    const { container, request, shipment } = harness()

    await resolveShippingReturnRequest(container, {
      request_id: "ret_1",
      decision: "reject",
    })

    expect(request.status).toBe("rejected")
    expect(shipment.simplified_status).toBe("delivered")
  })

  it("creates and persists one reverse CDEK shipment when approved", async () => {
    const { container, request, service, shipment } = harness()

    await resolveShippingReturnRequest(container, {
      request_id: "ret_1",
      decision: "approve",
    })

    expect(service.createCarrierReturnShipment).toHaveBeenCalledWith(
      "cdek_cdek",
      expect.objectContaining({
        return_id: "ret_1",
        forward_shipment_id: "direct-uuid",
        reason: "customer_return",
        order: expect.objectContaining({ id: "order_1" }),
      })
    )
    expect(request).toMatchObject({
      status: "approved",
      return_provider_shipment_id: "return-uuid",
      return_tracking_number: "return-track",
      return_delivery_status: "placed",
    })
    expect(service.claimShippingShipment).toHaveBeenCalledWith({
      order_id: "order_1",
      provider_key: "cdek_cdek",
      direction: "return",
      business_action_id: "return:ret_1",
      destination_key: "cdek_cdek",
    })
    expect(service.updateShippingShipments).toHaveBeenCalledWith(expect.objectContaining({
      id: "return_ship_1",
      status: "created",
      provider_shipment_id: "return-uuid",
      simplified_status: "return_in_progress",
    }))
    expect(shipment).toMatchObject({
      id: "ship_1",
      direction: "forward",
      provider_shipment_id: "direct-uuid",
    })
  })

  it("returns an idempotent result for the same decision and blocks decision reversal", async () => {
    for (const [status, decision] of [["approved", "approve"], ["rejected", "reject"]] as const) {
      const { container, request } = harness()
      request.status = status
      await expect(resolveShippingReturnRequest(container, {
        request_id: "ret_1", decision,
      })).resolves.toEqual({ request, changed: false, customer_email: null })
    }

    const { container, request } = harness()
    request.status = "approved"
    await expect(resolveShippingReturnRequest(container, {
      request_id: "ret_1", decision: "reject",
    })).rejects.toThrow("не может быть изменено")
  })

  it("rejects a request whose order is missing or lacks a customer email", async () => {
    for (const order of [undefined, { id: "order_1", email: "" }, { email: "buyer@test.com" }]) {
      const { container, query } = harness()
      query.graph.mockResolvedValue({ data: order ? [order] : [] })
      await expect(resolveShippingReturnRequest(container, {
        request_id: "ret_1", decision: "reject",
      })).rejects.toThrow("Заказ для заявки не найден")
    }
  })

  it("rejects without a shipment status to restore", async () => {
    const { container, request, service } = harness()
    request.previous_delivery_status = null
    service.listShippingShipments.mockResolvedValue([])
    await resolveShippingReturnRequest(container, { request_id: "ret_1", decision: "reject" })
    expect(service.updateShippingShipments).not.toHaveBeenCalled()
    expect(request.status).toBe("rejected")
  })

  it("does not create a reverse shipment record for an Ozon return", async () => {
    const { container, request, service } = harness()
    request.provider_key = "ozon_ozon"
    await resolveShippingReturnRequest(container, {
      request_id: "ret_1", decision: "approve",
    })
    expect(service.createCarrierReturnShipment).toHaveBeenCalledWith(
      "ozon_ozon",
      expect.objectContaining({ forward_shipment_id: "direct-uuid" })
    )
    expect(service.claimShippingShipment).not.toHaveBeenCalled()
    expect(request).toMatchObject({
      status: "approved", return_provider_shipment_id: "ozon-return-uuid",
    })
  })

  it("blocks automatic approval without a forward provider identity", async () => {
    const { container, shipment } = harness()
    shipment.provider_shipment_id = null

    await expect(resolveShippingReturnRequest(container, {
      request_id: "ret_1", decision: "approve",
    })).rejects.toThrow("нельзя автоматически")
  })
})
