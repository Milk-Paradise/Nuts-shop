import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import sendOrderConfirmationEmail, {
  orderConfirmationContent,
} from "../send-order-confirmation-email"

describe("order confirmation email", () => {
  it("uses the order snapshot and escapes pickup data", () => {
    const content = orderConfirmationContent({
      id: "order-1",
      display_id: 42,
      metadata: {
        store_pickup: true,
        store_pickup_address: "Старый <адрес>",
        store_pickup_hours: "10–19 & выходные",
      },
    })
    expect(content.text).toContain("Самовывоз: Старый <адрес>")
    expect(content.html).toContain("Старый &lt;адрес&gt;")
    expect(content.html).toContain("10–19 &amp; выходные")
  })

  it("logs and swallows notification failures", async () => {
    const query = {
      graph: jest.fn().mockResolvedValue({
        data: [{ id: "order_1", display_id: 42, email: "buyer@example.com" }],
      }),
    }
    const notification = {
      createNotifications: jest.fn().mockRejectedValue(new Error("smtp down")),
    }
    const logger = { error: jest.fn() }
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return query
        if (key === Modules.NOTIFICATION) return notification
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        throw new Error(`Unexpected container key: ${key}`)
      }),
    }

    await expect(
      sendOrderConfirmationEmail({
        event: { name: "order.placed", data: { id: "order_1" } },
        container,
      } as never)
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("smtp down"))
  })
})
