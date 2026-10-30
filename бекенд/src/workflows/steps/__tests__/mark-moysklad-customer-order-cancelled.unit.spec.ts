import { markMoyskladCustomerOrderCancelled } from "../mark-moysklad-customer-order-cancelled"
import type { MoyskladClient } from "../../../modules/moysklad-integration/client"

function buildContainer(overrides: Partial<{
  moyskladService: Record<string, jest.Mock>
}> = {}) {
  const moyskladService = {
    getOrderSyncStatus: jest.fn().mockResolvedValue(null),
    getConnectionConfig: jest
      .fn()
      .mockResolvedValue({ encrypted_credentials: "v1.encrypted", is_active: true }),
    recordCancellationAttempt: jest.fn().mockResolvedValue(undefined),
    ...overrides.moyskladService,
  }
  const container = {
    resolve: jest.fn(() => moyskladService),
  }

  return { container, moyskladService }
}

function buildClient(overrides: Partial<Record<keyof MoyskladClient, jest.Mock>> = {}) {
  return {
    markCustomerOrderCancelled: jest.fn().mockResolvedValue({
      id: "ms_order_1",
      meta: { href: "https://api.moysklad.ru/customerorder/ms_order_1" },
    }),
    ...overrides,
  } as unknown as MoyskladClient
}

describe("markMoyskladCustomerOrderCancelled", () => {
  it("does nothing when the order was never synced to MoySklad", async () => {
    const { container, moyskladService } = buildContainer({
      moyskladService: { getOrderSyncStatus: jest.fn().mockResolvedValue(null) },
    })
    const client = buildClient()

    const result = await markMoyskladCustomerOrderCancelled(
      container as never,
      { orderId: "order_1" },
      client
    )

    expect(result).toBeNull()
    expect(client.markCustomerOrderCancelled).not.toHaveBeenCalled()
    expect(moyskladService.recordCancellationAttempt).not.toHaveBeenCalled()
  })

  it("does nothing while the order sync is still pending or errored", async () => {
    const { container } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest
          .fn()
          .mockResolvedValue({ status: "error", moysklad_order_id: null }),
      },
    })
    const client = buildClient()

    const result = await markMoyskladCustomerOrderCancelled(
      container as never,
      { orderId: "order_1" },
      client
    )

    expect(result).toBeNull()
    expect(client.markCustomerOrderCancelled).not.toHaveBeenCalled()
  })

  it("does nothing when the sync is marked synced but has no MoySklad order id", async () => {
    const { container } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest
          .fn()
          .mockResolvedValue({ status: "synced", moysklad_order_id: null }),
      },
    })
    const client = buildClient()

    const result = await markMoyskladCustomerOrderCancelled(
      container as never,
      { orderId: "order_1" },
      client
    )

    expect(result).toBeNull()
    expect(client.markCustomerOrderCancelled).not.toHaveBeenCalled()
  })

  it("returns the existing sync without calling MoySklad again when the mark was already sent", async () => {
    const orderSync = {
      status: "synced",
      moysklad_order_id: "ms_order_1",
      cancellation_status: "synced",
    }
    const { container, moyskladService } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue(orderSync),
      },
    })
    const client = buildClient()

    const result = await markMoyskladCustomerOrderCancelled(
      container as never,
      { orderId: "order_1" },
      client
    )

    expect(result).toEqual(orderSync)
    expect(client.markCustomerOrderCancelled).not.toHaveBeenCalled()
    expect(moyskladService.recordCancellationAttempt).not.toHaveBeenCalled()
  })

  it("sends the cancellation mark and records success when already synced", async () => {
    const { container, moyskladService } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue({
          status: "synced",
          moysklad_order_id: "ms_order_1",
          cancellation_status: null,
        }),
      },
    })
    const client = buildClient()

    await markMoyskladCustomerOrderCancelled(
      container as never,
      { orderId: "order_1" },
      client
    )

    expect(client.markCustomerOrderCancelled).toHaveBeenCalledWith(
      "v1.encrypted",
      "ms_order_1",
      expect.stringContaining("order_1")
    )
    expect(moyskladService.recordCancellationAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "synced",
    })
  })

  it("retries a previously errored cancellation attempt", async () => {
    const { container, moyskladService } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue({
          status: "synced",
          moysklad_order_id: "ms_order_1",
          cancellation_status: "error",
        }),
      },
    })
    const client = buildClient()

    await markMoyskladCustomerOrderCancelled(
      container as never,
      { orderId: "order_1" },
      client
    )

    expect(client.markCustomerOrderCancelled).toHaveBeenCalled()
    expect(moyskladService.recordCancellationAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "synced",
    })
  })

  it("records an error and rethrows when the MoySklad connection is not configured", async () => {
    const { container, moyskladService } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue({
          status: "synced",
          moysklad_order_id: "ms_order_1",
          cancellation_status: null,
        }),
        getConnectionConfig: jest.fn().mockResolvedValue(null),
      },
    })
    const client = buildClient()

    await expect(
      markMoyskladCustomerOrderCancelled(container as never, { orderId: "order_1" }, client)
    ).rejects.toThrow("MoySklad connection is not configured.")

    expect(client.markCustomerOrderCancelled).not.toHaveBeenCalled()
    expect(moyskladService.recordCancellationAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "error",
      lastError: "MoySklad connection is not configured.",
    })
  })

  it("records an error and rethrows when the MoySklad API call fails", async () => {
    const { container, moyskladService } = buildContainer({
      moyskladService: {
        getOrderSyncStatus: jest.fn().mockResolvedValue({
          status: "synced",
          moysklad_order_id: "ms_order_1",
          cancellation_status: null,
        }),
      },
    })
    const client = buildClient({
      markCustomerOrderCancelled: jest.fn().mockRejectedValue(new Error("MoySklad unavailable")),
    })

    await expect(
      markMoyskladCustomerOrderCancelled(container as never, { orderId: "order_1" }, client)
    ).rejects.toThrow("MoySklad unavailable")

    expect(moyskladService.recordCancellationAttempt).toHaveBeenCalledWith({
      orderId: "order_1",
      status: "error",
      lastError: "MoySklad unavailable",
    })
  })
})
