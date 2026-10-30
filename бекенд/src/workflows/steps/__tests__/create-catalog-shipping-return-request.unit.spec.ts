import { createCatalogShippingReturnRequest } from "../create-catalog-shipping-return-request"

describe("createCatalogShippingReturnRequest", () => {
  it("creates one pending request and returns the same result on a repeated race outcome", async () => {
    const requests: any[] = []
    const shipment: any = { id: "ship_1", direction: "forward", simplified_status: "preparing" }
    const service = {
      listShippingReturnRequests: jest.fn(async () =>
        requests.filter((request) => request.status === "pending")),
      createShippingReturnRequests: jest.fn(async (input) => {
        const request = { id: "ret_1", ...input }
        requests.push(request)
        return request
      }),
      deleteShippingReturnRequests: jest.fn(),
      listShippingShipments: jest.fn().mockResolvedValue([shipment]),
      updateShippingShipments: jest.fn(async (input) => Object.assign(shipment, input)),
    }
    const container = {
      resolve: jest.fn(() => service),
    } as any
    const input = {
      order_id: "order_1",
      previous_delivery_status: "preparing" as const,
    }

    const first = await createCatalogShippingReturnRequest(container, input)
    const second = await createCatalogShippingReturnRequest(container, input)

    expect(first.created).toBe(true)
    expect(second).toMatchObject({ created: false, request: { id: "ret_1" } })
    expect(service.createShippingReturnRequests).toHaveBeenCalledTimes(1)
    expect(service.listShippingShipments).toHaveBeenCalledWith(expect.objectContaining({
      direction: "forward",
    }))
    expect(shipment.simplified_status).toBe("return_in_progress")
  })
})
