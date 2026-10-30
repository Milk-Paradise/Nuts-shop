import { GET } from "../route"

describe("GET /admin/orders/:id/moysklad-sync", () => {
  it("returns the current sync status for the requested order", async () => {
    const getOrderSyncStatus = jest.fn().mockResolvedValue({
      status: "error",
      moysklad_order_id: null,
      last_error: "MoySklad unavailable",
      attempts: 5,
      cancellation_status: null,
      cancellation_last_error: null,
      cancellation_attempts: 0,
    })
    const json = jest.fn()
    const res = { status: jest.fn().mockReturnThis(), json }
    const req = {
      params: { id: "order_1" },
      scope: { resolve: jest.fn().mockReturnValue({ getOrderSyncStatus }) },
    }

    await GET(req as never, res as never)

    expect(getOrderSyncStatus).toHaveBeenCalledWith("order_1")
    expect(res.status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
      status: "error",
      moysklad_order_id: null,
      last_error: "MoySklad unavailable",
      attempts: 5,
      cancellation_status: null,
      cancellation_last_error: null,
      cancellation_attempts: 0,
      payment_status: null,
      payment_last_error: null,
      payment_attempts: 0,
      moysklad_payment_id: null,
    })
  })

  it("returns the cancellation mark status alongside the create-sync status", async () => {
    const getOrderSyncStatus = jest.fn().mockResolvedValue({
      status: "synced",
      moysklad_order_id: "ms_order_1",
      last_error: null,
      attempts: 1,
      cancellation_status: "error",
      cancellation_last_error: "MoySklad unavailable",
      cancellation_attempts: 3,
    })
    const json = jest.fn()
    const res = { status: jest.fn().mockReturnThis(), json }
    const req = {
      params: { id: "order_1" },
      scope: { resolve: jest.fn().mockReturnValue({ getOrderSyncStatus }) },
    }

    await GET(req as never, res as never)

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        cancellation_status: "error",
        cancellation_last_error: "MoySklad unavailable",
        cancellation_attempts: 3,
      })
    )
  })

  it("returns an explicit not-sent state when no sync exists", async () => {
    const json = jest.fn()
    const res = { status: jest.fn().mockReturnThis(), json }
    const req = {
      params: { id: "order_1" },
      scope: { resolve: jest.fn().mockReturnValue({ getOrderSyncStatus: jest.fn().mockResolvedValue(null) }) },
    }

    await GET(req as never, res as never)

    expect(json).toHaveBeenCalledWith({
      status: null,
      moysklad_order_id: null,
      last_error: null,
      attempts: 0,
      cancellation_status: null,
      cancellation_last_error: null,
      cancellation_attempts: 0,
      payment_status: null,
      payment_last_error: null,
      payment_attempts: 0,
      moysklad_payment_id: null,
    })
  })

  // A queued payment must reach the panel as "pending", not as an error: it
  // means the integration was off when the order was paid, and an administrator
  // sent chasing a non-existent failure is worse than no signal at all.
  it("passes a queued payment through as its own state", async () => {
    const json = jest.fn()
    const res = { status: jest.fn().mockReturnThis(), json }
    const req = {
      params: { id: "order_1" },
      scope: {
        resolve: jest.fn().mockReturnValue({
          getOrderSyncStatus: jest.fn().mockResolvedValue({
            status: "synced",
            payment_status: "pending",
            payment_attempts: 0,
            payment_last_error: null,
          }),
        }),
      },
    }

    await GET(req as never, res as never)

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_status: "pending",
        payment_last_error: null,
        payment_attempts: 0,
      })
    )
  })
})
