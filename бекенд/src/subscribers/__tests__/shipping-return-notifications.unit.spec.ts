import { Modules } from "@medusajs/framework/utils"

import shippingReturnNotification from "../shipping-return-notifications"

describe("shippingReturnNotification subscriber", () => {
  it("logs and swallows notification failures", async () => {
    const notification = {
      createNotifications: jest.fn().mockRejectedValue(new Error("smtp down")),
    }
    const logger = { error: jest.fn() }
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === Modules.NOTIFICATION) return notification
        if (key === "logger") return logger
        throw new Error(`Unexpected container key: ${key}`)
      }),
    }

    await expect(
      shippingReturnNotification({
        event: {
          name: "catalog.shipping_return.requested",
          data: {
            order_id: "order_1",
            customer_email: "buyer@example.com",
          },
        },
        container,
      } as never)
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("smtp down"))
  })
})
