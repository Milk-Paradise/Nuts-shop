import { GET } from "../[id]/tracking/route"

jest.mock("../utils", () => ({
  retrieveAccountCustomer: jest.fn().mockResolvedValue({ id: "customer_1" }),
  retrieveAccountOrder: jest.fn().mockResolvedValue({ store_pickup: false }),
}))

it("returns Ozon registry tracking", async () => {
  const shipment = {
    simplified_status: "in_transit",
    tracking_number: "OZ-1",
    status_event_at: new Date("2026-09-30T10:00:00Z"),
    updated_at: new Date("2026-09-30T09:00:00Z"),
  }
  const service = {
    listShippingShipments: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([shipment]),
  }
  const res = { status: jest.fn(() => res), json: jest.fn() } as any
  await GET({ params: { id: "order_1" }, scope: { resolve: jest.fn(() => service) } } as any, res)
  expect(res.json).toHaveBeenCalledWith({ result: { status: "unchanged", tracking: {
    status: "in_transit", trackingNumber: "OZ-1", trackingUrl: null,
    polledAt: "2026-09-30T10:00:00.000Z",
  } } })
})
