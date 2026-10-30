import { GET } from "../route"

describe("GET /admin/moysklad/order-syncs", () => {
  it("filters order syncs by the selected status", async () => {
    const listMoyskladOrderSyncs = jest.fn().mockResolvedValue([
      { id: "sync_1", order_id: "order_1", status: "error", attempts: 2, last_error: "timeout" },
    ])
    const json = jest.fn()
    const res = { status: jest.fn().mockReturnThis(), json }
    const req = { validatedQuery: { status: "error" }, scope: { resolve: jest.fn().mockReturnValue({ listMoyskladOrderSyncs }) } }

    await GET(req as never, res as never)

    expect(listMoyskladOrderSyncs).toHaveBeenCalledWith({ status: "error" }, { take: 50, order: { updated_at: "DESC" } })
    expect(json).toHaveBeenCalledWith({ order_syncs: expect.any(Array) })
  })

  it("lists the newest bounded sync records for the All tab", async () => {
    const listMoyskladOrderSyncs = jest.fn().mockResolvedValue([])
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }
    const req = { validatedQuery: {}, scope: { resolve: jest.fn().mockReturnValue({ listMoyskladOrderSyncs }) } }

    await GET(req as never, res as never)

    expect(listMoyskladOrderSyncs).toHaveBeenCalledWith({}, { take: 50, order: { updated_at: "DESC" } })
  })
})
