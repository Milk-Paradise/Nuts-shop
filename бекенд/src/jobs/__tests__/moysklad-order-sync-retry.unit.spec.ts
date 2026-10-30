jest.mock("../../workflows/steps/create-moysklad-customer-order", () => ({
  createMoyskladCustomerOrder: jest.fn(),
}))
jest.mock("../../workflows/steps/mark-moysklad-customer-order-cancelled", () => ({
  markMoyskladCustomerOrderCancelled: jest.fn(),
}))
jest.mock("../../workflows/steps/create-moysklad-incoming-payment", () => ({
  createMoyskladIncomingPayment: jest.fn(),
}))
jest.mock("../../workflows/create-moysklad-customer-order", () => ({
  createMoyskladCustomerOrderWorkflow: jest.fn((container: unknown) => ({
    run: ({ input }: { input: unknown }) =>
      require("../../workflows/steps/create-moysklad-customer-order").createMoyskladCustomerOrder(container, input),
  })),
}))
jest.mock("../../workflows/sync-moysklad-order-cancellation", () => ({
  syncMoyskladOrderCancellationWorkflow: jest.fn((container: unknown) => ({
    run: ({ input }: { input: unknown }) =>
      require("../../workflows/steps/mark-moysklad-customer-order-cancelled").markMoyskladCustomerOrderCancelled(container, input),
  })),
}))
jest.mock("../../workflows/create-moysklad-incoming-payment", () => ({
  createMoyskladIncomingPaymentWorkflow: jest.fn((container: unknown) => ({
    run: ({ input }: { input: unknown }) =>
      require("../../workflows/steps/create-moysklad-incoming-payment").createMoyskladIncomingPayment(container, input),
  })),
}))

import { createMoyskladCustomerOrder } from "../../workflows/steps/create-moysklad-customer-order"
import { markMoyskladCustomerOrderCancelled } from "../../workflows/steps/mark-moysklad-customer-order-cancelled"
import retryMoyskladOrderSync from "../moysklad-order-sync-retry"
import { createMoyskladIncomingPayment } from "../../workflows/steps/create-moysklad-incoming-payment"

const createMoyskladCustomerOrderMock =
  createMoyskladCustomerOrder as jest.Mock
const markMoyskladCustomerOrderCancelledMock =
  markMoyskladCustomerOrderCancelled as jest.Mock
const createMoyskladIncomingPaymentMock = createMoyskladIncomingPayment as jest.Mock

function buildContainer(overrides: {
  isActive?: boolean
  orderSyncs?: unknown[]
} = {}) {
  const logger = { info: jest.fn(), error: jest.fn() }
  const moyskladService = {
    getConnectionConfig: jest
      .fn()
      .mockResolvedValue({ is_active: overrides.isActive ?? true }),
    listMoyskladOrderSyncs: jest
      .fn()
      .mockResolvedValue(overrides.orderSyncs ?? []),
    claimOrderSyncForRetry: jest.fn().mockResolvedValue({ id: "sync_1" }),
    claimCancellationForRetry: jest.fn().mockResolvedValue({ id: "sync_1" }),
    claimPaymentForRetry: jest.fn().mockResolvedValue({ id: "sync_1" }),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "logger") return logger
      return moyskladService
    }),
  }

  return { container, logger, moyskladService }
}

describe("retryMoyskladOrderSync job", () => {
  beforeEach(() => {
    createMoyskladCustomerOrderMock.mockReset()
    markMoyskladCustomerOrderCancelledMock.mockReset()
    createMoyskladIncomingPaymentMock.mockReset()
  })

  it("does nothing when the integration is disabled", async () => {
    const { container, moyskladService } = buildContainer({ isActive: false })

    await retryMoyskladOrderSync(container as never)

    expect(moyskladService.listMoyskladOrderSyncs).not.toHaveBeenCalled()
    expect(createMoyskladCustomerOrderMock).not.toHaveBeenCalled()
  })

  it("retries only the order syncs that are due, skipping synced and not-yet-due ones", async () => {
    const now = Date.now()
    const dueError = {
      order_id: "order_due",
      status: "error",
      attempts: 1,
      updated_at: new Date(now - 2 * 60_000),
    }
    const notDueError = {
      order_id: "order_not_due",
      status: "error",
      attempts: 1,
      updated_at: new Date(now),
    }
    const alreadySynced = {
      order_id: "order_synced",
      status: "synced",
      attempts: 1,
      updated_at: new Date(now - 24 * 60 * 60_000),
    }
    const { container } = buildContainer({
      orderSyncs: [dueError, notDueError, alreadySynced],
    })
    createMoyskladCustomerOrderMock.mockResolvedValue(undefined)

    await retryMoyskladOrderSync(container as never)

    expect(createMoyskladCustomerOrderMock).toHaveBeenCalledTimes(1)
    expect(createMoyskladCustomerOrderMock).toHaveBeenCalledWith(container, {
      orderId: "order_due",
    })
  })

  it("continues retrying the remaining orders when one retry attempt throws", async () => {
    const now = Date.now()
    const first = {
      order_id: "order_1",
      status: "error",
      attempts: 1,
      updated_at: new Date(now - 2 * 60_000),
    }
    const second = {
      order_id: "order_2",
      status: "error",
      attempts: 1,
      updated_at: new Date(now - 2 * 60_000),
    }
    const { container, logger } = buildContainer({
      orderSyncs: [first, second],
    })
    createMoyskladCustomerOrderMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined)

    await retryMoyskladOrderSync(container as never)

    expect(createMoyskladCustomerOrderMock).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("boom")
    )
  })

  it("does not retry an order sync that has exhausted all attempts", async () => {
    const exhausted = {
      order_id: "order_exhausted",
      status: "error",
      attempts: 6,
      updated_at: new Date(0),
    }
    const { container } = buildContainer({ orderSyncs: [exhausted] })

    await retryMoyskladOrderSync(container as never)

    expect(createMoyskladCustomerOrderMock).not.toHaveBeenCalled()
  })

  it("does not automatically retry a data error", async () => {
    const now = Date.now()
    const { container, moyskladService } = buildContainer({
      orderSyncs: [
        {
          order_id: "order_bad_data",
          status: "error",
          retryable: false,
          attempts: 1,
          updated_at: new Date(now - 2 * 60_000),
        },
      ],
    })

    await retryMoyskladOrderSync(container as never)

    expect(moyskladService.claimOrderSyncForRetry).not.toHaveBeenCalled()
    expect(createMoyskladCustomerOrderMock).not.toHaveBeenCalled()
  })

  it("continues automatically retrying a temporary service error", async () => {
    const now = Date.now()
    const { container } = buildContainer({
      orderSyncs: [
        {
          order_id: "order_service_unavailable",
          status: "error",
          retryable: true,
          attempts: 1,
          updated_at: new Date(now - 2 * 60_000),
        },
      ],
    })
    createMoyskladCustomerOrderMock.mockResolvedValue(undefined)

    await retryMoyskladOrderSync(container as never)

    expect(createMoyskladCustomerOrderMock).toHaveBeenCalledWith(container, {
      orderId: "order_service_unavailable",
    })
  })

  it("claims the retry slot before creating the order, so an overlapping tick would see it as not due", async () => {
    const now = Date.now()
    const due = {
      order_id: "order_due",
      status: "error",
      attempts: 1,
      updated_at: new Date(now - 2 * 60_000),
    }
    const { container, moyskladService } = buildContainer({ orderSyncs: [due] })
    createMoyskladCustomerOrderMock.mockResolvedValue(undefined)

    await retryMoyskladOrderSync(container as never)

    expect(moyskladService.claimOrderSyncForRetry).toHaveBeenCalledWith(
      "order_due",
      ["pending", "error", "syncing"]
    )
    const claimCallOrder = moyskladService.claimOrderSyncForRetry.mock
      .invocationCallOrder[0]
    const createCallOrder = createMoyskladCustomerOrderMock.mock
      .invocationCallOrder[0]
    expect(claimCallOrder).toBeLessThan(createCallOrder)
  })

  it("skips an order when another retry has already claimed it", async () => {
    const now = Date.now()
    const { container, moyskladService } = buildContainer({
      orderSyncs: [{ order_id: "order_due", status: "error", attempts: 1, updated_at: new Date(now - 2 * 60_000) }],
    })
    moyskladService.claimOrderSyncForRetry.mockResolvedValue(null)

    await retryMoyskladOrderSync(container as never)

    expect(createMoyskladCustomerOrderMock).not.toHaveBeenCalled()
  })

  it("does not retry an order sync that another tick already claimed and is still in progress", async () => {
    const now = Date.now()
    const claimed = {
      order_id: "order_claimed",
      status: "syncing",
      attempts: 1,
      updated_at: new Date(now - 30_000),
    }
    const { container } = buildContainer({ orderSyncs: [claimed] })

    await retryMoyskladOrderSync(container as never)

    expect(createMoyskladCustomerOrderMock).not.toHaveBeenCalled()
  })

  it("does not treat orders with no cancellation requested as due for a cancellation retry", async () => {
    const now = Date.now()
    const noCancellation = {
      order_id: "order_1",
      status: "synced",
      attempts: 1,
      updated_at: new Date(now - 24 * 60 * 60_000),
      cancellation_status: null,
      cancellation_attempts: 0,
      cancellation_updated_at: null,
    }
    const { container } = buildContainer({ orderSyncs: [noCancellation] })

    await retryMoyskladOrderSync(container as never)

    expect(markMoyskladCustomerOrderCancelledMock).not.toHaveBeenCalled()
  })

  it("retries a due cancellation mark using the same claim-before-call pattern as creation", async () => {
    const now = Date.now()
    const dueCancellation = {
      order_id: "order_due",
      status: "synced",
      moysklad_order_id: "ms_order_due",
      attempts: 1,
      updated_at: new Date(now - 24 * 60 * 60_000),
      cancellation_status: "error",
      cancellation_attempts: 1,
      cancellation_updated_at: new Date(now - 2 * 60_000),
    }
    const { container, moyskladService } = buildContainer({
      orderSyncs: [dueCancellation],
    })
    markMoyskladCustomerOrderCancelledMock.mockResolvedValue(undefined)

    await retryMoyskladOrderSync(container as never)

    expect(moyskladService.claimCancellationForRetry).toHaveBeenCalledWith(
      "order_due",
      ["pending", "error", "syncing"]
    )
    expect(markMoyskladCustomerOrderCancelledMock).toHaveBeenCalledWith(
      container,
      { orderId: "order_due" }
    )
  })

  it.each([
    [2, 5],
    [3, 30],
    [4, 120],
    [5, 720],
  ])(
    "retries cancellation attempt %i after the shared %i-minute delay",
    async (attempts, delayMinutes) => {
      const now = Date.now()
      const { container } = buildContainer({
        orderSyncs: [{
          order_id: `order_${attempts}`,
          status: "synced",
          moysklad_order_id: `ms_order_${attempts}`,
          attempts: 1,
          updated_at: new Date(now - 24 * 60 * 60_000),
          cancellation_status: "error",
          cancellation_attempts: attempts,
          cancellation_updated_at: new Date(now - delayMinutes * 60_000 - 1_000),
        }],
      })

      await retryMoyskladOrderSync(container as never)

      expect(markMoyskladCustomerOrderCancelledMock).toHaveBeenCalledWith(
        container,
        { orderId: `order_${attempts}` }
      )
    }
  )

  it("stops retrying a cancellation after the five shared retries are exhausted", async () => {
    const now = Date.now()
    const { container, moyskladService } = buildContainer({
      orderSyncs: [{
        order_id: "order_exhausted",
        status: "synced",
        moysklad_order_id: "ms_order_exhausted",
        attempts: 1,
        updated_at: new Date(now - 24 * 60 * 60_000),
        cancellation_status: "error",
        cancellation_attempts: 6,
        cancellation_updated_at: new Date(0),
      }],
    })

    await retryMoyskladOrderSync(container as never)

    expect(moyskladService.claimCancellationForRetry).not.toHaveBeenCalled()
    expect(markMoyskladCustomerOrderCancelledMock).not.toHaveBeenCalled()
  })

  it("skips a cancellation retry when another tick already claimed it", async () => {
    const now = Date.now()
    const dueCancellation = {
      order_id: "order_due",
      status: "synced",
      moysklad_order_id: "ms_order_due",
      attempts: 1,
      updated_at: new Date(now - 24 * 60 * 60_000),
      cancellation_status: "error",
      cancellation_attempts: 1,
      cancellation_updated_at: new Date(now - 2 * 60_000),
    }
    const { container, moyskladService } = buildContainer({
      orderSyncs: [dueCancellation],
    })
    moyskladService.claimCancellationForRetry.mockResolvedValue(null)

    await retryMoyskladOrderSync(container as never)

    expect(markMoyskladCustomerOrderCancelledMock).not.toHaveBeenCalled()
  })

  it("continues retrying cancellations for the remaining orders when one attempt throws", async () => {
    const now = Date.now()
    const first = {
      order_id: "order_1",
      status: "synced",
      moysklad_order_id: "ms_order_1",
      attempts: 1,
      updated_at: new Date(now - 24 * 60 * 60_000),
      cancellation_status: "error",
      cancellation_attempts: 1,
      cancellation_updated_at: new Date(now - 2 * 60_000),
    }
    const second = {
      order_id: "order_2",
      status: "synced",
      moysklad_order_id: "ms_order_2",
      attempts: 1,
      updated_at: new Date(now - 24 * 60 * 60_000),
      cancellation_status: "error",
      cancellation_attempts: 1,
      cancellation_updated_at: new Date(now - 2 * 60_000),
    }
    const { container, logger } = buildContainer({ orderSyncs: [first, second] })
    markMoyskladCustomerOrderCancelledMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined)

    await retryMoyskladOrderSync(container as never)

    expect(markMoyskladCustomerOrderCancelledMock).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("boom"))
  })

  it("retries a due payment through its independent claim and leaves order state untouched", async () => {
    const now = Date.now()
    const row = {
      order_id: "order_paid", status: "synced", attempts: 1, updated_at: new Date(now),
      moysklad_order_id: "ms_order", cancellation_status: null, cancellation_attempts: 0, cancellation_updated_at: null,
      payment_status: "error", payment_attempts: 1, payment_updated_at: new Date(now - 2 * 60_000),
      payment_paid_at: new Date("2026-09-10T10:30:00Z"), payment_amount: 100, payment_currency_code: "rub"
    }
    const { container, moyskladService } = buildContainer({ orderSyncs: [row] })
    await retryMoyskladOrderSync(container as never)
    expect(moyskladService.claimPaymentForRetry).toHaveBeenCalledWith("order_paid", ["pending", "error", "syncing"], row.payment_updated_at)
    expect(createMoyskladIncomingPaymentMock).toHaveBeenCalledWith(container, {
      orderId: "order_paid", amount: 100, currencyCode: "rub", paidAt: row.payment_paid_at
    })
    expect(moyskladService.claimOrderSyncForRetry).not.toHaveBeenCalled()
  })

  it("sends a payment accumulated while disabled immediately after activation even with zero attempts", async () => {
    const row = {
      order_id: "order_disabled_payment", status: "synced", attempts: 1, updated_at: new Date(),
      moysklad_order_id: "ms_order", cancellation_status: null, cancellation_attempts: 0, cancellation_updated_at: null,
      payment_status: "pending", payment_attempts: 0, payment_updated_at: new Date(),
      payment_paid_at: new Date("2026-09-10T10:30:00Z"), payment_amount: 100, payment_currency_code: "rub"
    }
    const { container } = buildContainer({ isActive: true, orderSyncs: [row] })
    await retryMoyskladOrderSync(container as never)
    expect(createMoyskladIncomingPaymentMock).toHaveBeenCalledWith(container, expect.objectContaining({ orderId: "order_disabled_payment" }))
  })

  it("does not claim a waiting payment before its customer order is synchronized", async () => {
    const row = {
      order_id: "order_waiting", status: "pending", attempts: 1, updated_at: new Date(), moysklad_order_id: null,
      cancellation_status: null, cancellation_attempts: 0, cancellation_updated_at: null,
      payment_status: "pending", payment_attempts: 0, payment_updated_at: new Date(),
      payment_paid_at: new Date(), payment_amount: 100, payment_currency_code: "rub"
    }
    const { container, moyskladService } = buildContainer({ orderSyncs: [row] })
    await retryMoyskladOrderSync(container as never)
    expect(moyskladService.claimPaymentForRetry).not.toHaveBeenCalled()
    expect(createMoyskladIncomingPaymentMock).not.toHaveBeenCalled()
  })
})
