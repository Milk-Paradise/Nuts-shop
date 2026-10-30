jest.mock("../create-moysklad-customer-order", () => ({
  createMoyskladCustomerOrder: jest.fn(),
}))
jest.mock("../mark-moysklad-customer-order-cancelled", () => ({
  markMoyskladCustomerOrderCancelled: jest.fn(),
}))
jest.mock("../create-moysklad-incoming-payment", () => ({ createMoyskladIncomingPayment: jest.fn() }))

import { createMoyskladCustomerOrder } from "../create-moysklad-customer-order"
import { markMoyskladCustomerOrderCancelled } from "../mark-moysklad-customer-order-cancelled"
import { retryMoyskladOrderSync } from "../retry-moysklad-order-sync"
import { createMoyskladIncomingPayment } from "../create-moysklad-incoming-payment"

const createMoyskladCustomerOrderMock = createMoyskladCustomerOrder as jest.Mock
const markMoyskladCustomerOrderCancelledMock =
  markMoyskladCustomerOrderCancelled as jest.Mock
const createMoyskladIncomingPaymentMock = createMoyskladIncomingPayment as jest.Mock

describe("retryMoyskladOrderSync", () => {
  beforeEach(() => {
    createMoyskladCustomerOrderMock.mockReset()
    markMoyskladCustomerOrderCancelledMock.mockReset()
    createMoyskladIncomingPaymentMock.mockReset()
  })

  it("allows a manual retry only after a failed synchronization", async () => {
    const service = {
      getOrderSyncStatus: jest.fn().mockResolvedValue({ status: "error" }),
      claimOrderSyncForRetry: jest.fn().mockResolvedValue(null),
    }
    const container = { resolve: jest.fn().mockReturnValue(service) }

    await expect(
      retryMoyskladOrderSync(container as never, { orderId: "order_1" })
    ).rejects.toThrow("Only failed MoySklad order synchronizations can be retried manually.")
  })

  it("starts the claimed failed synchronization immediately", async () => {
    const service = {
      getOrderSyncStatus: jest.fn().mockResolvedValue({
        status: "error",
        retryable: false,
      }),
      claimOrderSyncForRetry: jest.fn().mockResolvedValue({ id: "sync_1" }),
    }
    const container = { resolve: jest.fn().mockReturnValue(service) }
    const result = { status: "synced", moysklad_order_id: "ms_1" }
    createMoyskladCustomerOrderMock.mockResolvedValue(result)

    await expect(
      retryMoyskladOrderSync(container as never, { orderId: "order_1" })
    ).resolves.toEqual(result)

    expect(service.claimOrderSyncForRetry).toHaveBeenCalledWith("order_1", ["error"])
    expect(createMoyskladCustomerOrderMock).toHaveBeenCalledWith(container, {
      orderId: "order_1",
    })
  })

  it("starts a failed cancellation-mark retry from the same manual action", async () => {
    const service = {
      getOrderSyncStatus: jest.fn().mockResolvedValue({
        status: "synced",
        cancellation_status: "error",
      }),
      claimCancellationForRetry: jest.fn().mockResolvedValue({ id: "sync_1" }),
      claimOrderSyncForRetry: jest.fn(),
    }
    const container = { resolve: jest.fn().mockReturnValue(service) }
    const result = { status: "synced", cancellation_status: "synced" }
    markMoyskladCustomerOrderCancelledMock.mockResolvedValue(result)

    await expect(
      retryMoyskladOrderSync(container as never, { orderId: "order_1" })
    ).resolves.toEqual(result)

    expect(service.claimCancellationForRetry).toHaveBeenCalledWith(
      "order_1",
      ["error"]
    )
    expect(markMoyskladCustomerOrderCancelledMock).toHaveBeenCalledWith(
      container,
      { orderId: "order_1" }
    )
    expect(service.claimOrderSyncForRetry).not.toHaveBeenCalled()
  })

  it("manually retries payment without resetting order or cancellation state", async () => {
    const paidAt = new Date("2026-09-10T10:30:00Z")
    const service = {
      getOrderSyncStatus: jest.fn().mockResolvedValue({ status: "synced", cancellation_status: "synced", payment_status: "error", payment_amount: 100, payment_currency_code: "rub", payment_paid_at: paidAt }),
      claimPaymentForRetry: jest.fn().mockResolvedValue({ id: "sync_1" }),
      claimOrderSyncForRetry: jest.fn(), claimCancellationForRetry: jest.fn()
    }
    const container = { resolve: jest.fn().mockReturnValue(service) }
    createMoyskladIncomingPaymentMock.mockResolvedValue({ payment_status: "synced" })
    await retryMoyskladOrderSync(container as never, { orderId: "order_1" })
    expect(createMoyskladIncomingPaymentMock).toHaveBeenCalledWith(container, { orderId: "order_1", amount: 100, currencyCode: "rub", paidAt })
    expect(service.claimOrderSyncForRetry).not.toHaveBeenCalled()
    expect(service.claimCancellationForRetry).not.toHaveBeenCalled()
  })

  // The three transfers are independent, so a manual retry has to act on the
  // one whose button was pressed. Without an explicit target the branches are
  // tried in a fixed order and the order button would retry the payment.
  describe("addressed manual retry", () => {
    function serviceWithBothFailed() {
      return {
        getOrderSyncStatus: jest.fn().mockResolvedValue({
          status: "error",
          cancellation_status: "error",
          payment_status: "error",
          payment_amount: 100,
          payment_currency_code: "rub",
          payment_paid_at: new Date("2026-09-10T10:30:00Z"),
        }),
        claimOrderSyncForRetry: jest.fn().mockResolvedValue({ id: "sync_1" }),
        claimCancellationForRetry: jest.fn().mockResolvedValue({ id: "sync_1" }),
        claimPaymentForRetry: jest.fn().mockResolvedValue({ id: "sync_1" }),
      }
    }

    it("retries the order and leaves the failed payment alone", async () => {
      const service = serviceWithBothFailed()
      const container = { resolve: jest.fn().mockReturnValue(service) }
      createMoyskladCustomerOrderMock.mockResolvedValue({ status: "synced" })

      await retryMoyskladOrderSync(container as never, { orderId: "order_1", target: "order" })

      expect(createMoyskladCustomerOrderMock).toHaveBeenCalled()
      expect(createMoyskladIncomingPaymentMock).not.toHaveBeenCalled()
      expect(markMoyskladCustomerOrderCancelledMock).not.toHaveBeenCalled()
      expect(service.claimPaymentForRetry).not.toHaveBeenCalled()
    })

    it("retries the payment and leaves the failed order transfer alone", async () => {
      const service = serviceWithBothFailed()
      const container = { resolve: jest.fn().mockReturnValue(service) }
      createMoyskladIncomingPaymentMock.mockResolvedValue({ payment_status: "synced" })

      await retryMoyskladOrderSync(container as never, { orderId: "order_1", target: "payment" })

      expect(createMoyskladIncomingPaymentMock).toHaveBeenCalled()
      expect(createMoyskladCustomerOrderMock).not.toHaveBeenCalled()
      expect(service.claimOrderSyncForRetry).not.toHaveBeenCalled()
    })

    it("retries the cancellation and leaves the failed payment alone", async () => {
      const service = serviceWithBothFailed()
      const container = { resolve: jest.fn().mockReturnValue(service) }
      markMoyskladCustomerOrderCancelledMock.mockResolvedValue({ cancellation_status: "synced" })

      await retryMoyskladOrderSync(container as never, { orderId: "order_1", target: "cancellation" })

      expect(markMoyskladCustomerOrderCancelledMock).toHaveBeenCalled()
      expect(createMoyskladIncomingPaymentMock).not.toHaveBeenCalled()
      expect(service.claimPaymentForRetry).not.toHaveBeenCalled()
    })

    it("refuses to retry a payment that is queued rather than failed", async () => {
      const service = {
        // Waiting for a switched-off integration is a queue, not a failure:
        // there is nothing to retry and pretending otherwise would reset it.
        getOrderSyncStatus: jest.fn().mockResolvedValue({ status: "synced", payment_status: "pending" }),
        claimPaymentForRetry: jest.fn(),
      }
      const container = { resolve: jest.fn().mockReturnValue(service) }

      await expect(
        retryMoyskladOrderSync(container as never, { orderId: "order_1", target: "payment" })
      ).rejects.toThrow("Only a failed MoySklad payment transfer can be retried manually.")
      expect(service.claimPaymentForRetry).not.toHaveBeenCalled()
      expect(createMoyskladIncomingPaymentMock).not.toHaveBeenCalled()
    })
  })

  it("returns the current cancellation state when another retry already claimed it", async () => {
    const current = {
      status: "synced",
      cancellation_status: "syncing",
    }
    const service = {
      getOrderSyncStatus: jest
        .fn()
        .mockResolvedValueOnce({ status: "synced", cancellation_status: "error" })
        .mockResolvedValueOnce(current),
      claimCancellationForRetry: jest.fn().mockResolvedValue(null),
      claimOrderSyncForRetry: jest.fn(),
    }
    const container = { resolve: jest.fn().mockReturnValue(service) }

    await expect(
      retryMoyskladOrderSync(container as never, { orderId: "order_1" })
    ).resolves.toEqual(current)

    expect(markMoyskladCustomerOrderCancelledMock).not.toHaveBeenCalled()
    expect(service.claimOrderSyncForRetry).not.toHaveBeenCalled()
  })
})
