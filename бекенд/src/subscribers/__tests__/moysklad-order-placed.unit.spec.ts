jest.mock("../../workflows/create-moysklad-customer-order", () => ({
  createMoyskladCustomerOrderWorkflow: jest.fn(),
}))

import { createMoyskladCustomerOrderWorkflow } from "../../workflows/create-moysklad-customer-order"
import syncOrderToMoysklad from "../moysklad-order-placed"

const createMoyskladCustomerOrderWorkflowMock =
  createMoyskladCustomerOrderWorkflow as unknown as jest.Mock

function buildContainer(getConnectionConfig: jest.Mock) {
  const logger = { info: jest.fn(), error: jest.fn() }
  const moyskladService = { getConnectionConfig }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "logger") return logger
      return moyskladService
    }),
  }

  return { container, logger }
}

describe("syncOrderToMoysklad subscriber", () => {
  beforeEach(() => {
    createMoyskladCustomerOrderWorkflowMock.mockReset()
  })

  it("does not attempt to sync when the integration is disabled", async () => {
    createMoyskladCustomerOrderWorkflowMock.mockReturnValue({ run: jest.fn() })
    const { container, logger } = buildContainer(
      jest.fn().mockResolvedValue({ is_active: false })
    )

    await syncOrderToMoysklad({
      event: { name: "order.placed", data: { id: "order_1" } },
      container: container as never,
    } as never)

    expect(createMoyskladCustomerOrderWorkflowMock).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("does not attempt to sync when the integration is not configured at all", async () => {
    createMoyskladCustomerOrderWorkflowMock.mockReturnValue({ run: jest.fn() })
    const { container } = buildContainer(jest.fn().mockResolvedValue(null))

    await syncOrderToMoysklad({
      event: { name: "order.placed", data: { id: "order_1" } },
      container: container as never,
    } as never)

    expect(createMoyskladCustomerOrderWorkflowMock).not.toHaveBeenCalled()
  })

  it("triggers the MoySklad order creation when the integration is active", async () => {
    const run = jest.fn().mockResolvedValue(undefined)
    createMoyskladCustomerOrderWorkflowMock.mockReturnValue({ run })
    const { container, logger } = buildContainer(
      jest.fn().mockResolvedValue({ is_active: true })
    )

    await syncOrderToMoysklad({
      event: { name: "order.placed", data: { id: "order_1" } },
      container: container as never,
    } as never)

    expect(createMoyskladCustomerOrderWorkflowMock).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({ input: { orderId: "order_1" } })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("logs and swallows the error instead of throwing when the sync attempt fails", async () => {
    createMoyskladCustomerOrderWorkflowMock.mockReturnValue({
      run: jest.fn().mockRejectedValue(new Error("boom")),
    })
    const { container, logger } = buildContainer(
      jest.fn().mockResolvedValue({ is_active: true })
    )

    await expect(
      syncOrderToMoysklad({
        event: { name: "order.placed", data: { id: "order_1" } },
        container: container as never,
      } as never)
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("boom")
    )
  })
})
