jest.mock("../../workflows/sync-moysklad-order-cancellation", () => ({
  syncMoyskladOrderCancellationWorkflow: jest.fn(),
}))

import { syncMoyskladOrderCancellationWorkflow } from "../../workflows/sync-moysklad-order-cancellation"
import markMoyskladOrderCancelled from "../moysklad-order-canceled"

const workflow = syncMoyskladOrderCancellationWorkflow as unknown as jest.Mock

describe("markMoyskladOrderCancelled subscriber", () => {
  it("delegates the cancellation to the workflow", async () => {
    const run = jest.fn().mockResolvedValue(undefined)
    workflow.mockReturnValue({ run })
    const container = { resolve: jest.fn() }

    await markMoyskladOrderCancelled({ event: { name: "order.canceled", data: { id: "order_1" } }, container } as never)

    expect(workflow).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({ input: { orderId: "order_1" } })
  })
})
