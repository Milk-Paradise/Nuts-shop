import { OrderWorkflowEvents } from "@medusajs/framework/utils"

import notifySellerNewOrder, {
  config as newOrderConfig,
} from "../notify-seller-new-order"
import notifySellerReturnRequest, {
  config as returnRequestConfig,
} from "../notify-seller-return-request"
import { CATALOG_SHIPPING_RETURN_REQUESTED } from "../../workflows/cancel-catalog-customer-order"

function buildContainer() {
  const createNotifications = jest.fn().mockResolvedValue([])
  const logger = { error: jest.fn() }
  const resolve = jest.fn((key: string) =>
    key === "notification" ? { createNotifications } : logger
  )
  return { container: { resolve }, createNotifications, logger }
}

describe("seller notification subscribers", () => {
  it("initiates a seller notification when an order is placed", async () => {
    const { container, createNotifications } = buildContainer()

    await notifySellerNewOrder({
      event: { name: OrderWorkflowEvents.PLACED, data: { id: "order_1" } },
      container,
    } as never)

    expect(createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "seller",
        channel: "email",
        template: "seller-new-order",
        data: { order_id: "order_1" },
      })
    )
    expect(newOrderConfig).toMatchObject({ event: OrderWorkflowEvents.PLACED })
  })

  it("initiates a seller notification for a return request", async () => {
    const { container, createNotifications } = buildContainer()

    await notifySellerReturnRequest({
      event: {
        name: CATALOG_SHIPPING_RETURN_REQUESTED,
        data: {
          order_id: "order_1",
          return_request_id: "return_1",
          return_reason: "Не подошёл размер",
        },
      },
      container,
    } as never)

    expect(createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "seller",
        template: "seller-return-request",
        data: expect.objectContaining({
          order_id: "order_1",
          return_request_id: "return_1",
          return_reason: "Не подошёл размер",
        }),
      })
    )
    expect(returnRequestConfig).toMatchObject({
      event: CATALOG_SHIPPING_RETURN_REQUESTED,
    })
  })
})
