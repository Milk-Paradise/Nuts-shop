import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import sendPaymentConfirmationEmail, {
  config,
  hasCapturedOnlinePayment,
} from "../send-payment-confirmation-email"

function buildContainer(order: Record<string, unknown> | undefined) {
  const query = {
    graph: jest.fn().mockResolvedValue({ data: order ? [order] : [] }),
  }
  const notification = { createNotifications: jest.fn().mockResolvedValue([]) }
  const logger = { error: jest.fn() }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === Modules.NOTIFICATION) return notification
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      throw new Error(`Unexpected container key: ${key}`)
    }),
  }

  return { container, query, notification, logger }
}

function placedEvent(container: unknown) {
  return {
    event: { name: "order.placed", data: { id: "order_1" } },
    container,
  } as never
}

describe("sendPaymentConfirmationEmail subscriber", () => {
  it("is registered for the standard order.placed event", () => {
    expect(config).toMatchObject({
      event: "order.placed",
      context: { subscriberId: "send-payment-confirmation-email" },
    })
  })

  it("sends a confirmation for a captured YooKassa payment", async () => {
    const { container, notification } = buildContainer({
      id: "order_1",
      display_id: 42,
      email: "buyer@example.com",
      payment_collections: [
        {
          payments: [
            {
              provider_id: "pp_yookassa_yookassa",
              captured_at: "2026-09-08T10:00:00.000Z",
            },
          ],
        },
      ],
    })

    await sendPaymentConfirmationEmail(placedEvent(container))

    expect(notification.createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        channel: "email",
        template: "order-payment-confirmed",
        data: { order_id: "order_1", display_id: 42 },
        content: expect.objectContaining({
          subject: "Оплата заказа №42 подтверждена",
        }),
      })
    )
  })

  it("does not send for the manual/system Awaiting flow", async () => {
    const { container, notification } = buildContainer({
      id: "order_1",
      email: "buyer@example.com",
      payment_collections: [
        {
          payments: [
            { provider_id: "pp_system_default", captured_at: null },
          ],
        },
      ],
    })

    await sendPaymentConfirmationEmail(placedEvent(container))

    expect(notification.createNotifications).not.toHaveBeenCalled()
  })

  it("does not send for an uncaptured online payment", () => {
    expect(
      hasCapturedOnlinePayment({
        id: "order_1",
        payment_collections: [
          {
            payments: [
              { provider_id: "pp_yookassa_yookassa", captured_at: null },
            ],
          },
        ],
      })
    ).toBe(false)
  })

  it("logs and swallows notification failures", async () => {
    const { container, notification, logger } = buildContainer({
      id: "order_1",
      email: "buyer@example.com",
      payment_collections: [
        {
          payments: [
            {
              provider_id: "pp_yookassa_yookassa",
              captured_at: "2026-09-08T10:00:00.000Z",
            },
          ],
        },
      ],
    })
    notification.createNotifications.mockRejectedValue(new Error("stub failed"))

    await expect(
      sendPaymentConfirmationEmail(placedEvent(container))
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("stub failed"))
  })
})
