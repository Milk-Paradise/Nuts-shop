import { Modules } from "@medusajs/framework/utils"

import sendPasswordResetEmail, { config } from "../send-password-reset-email"

function buildContainer() {
  const logger = { info: jest.fn(), error: jest.fn() }
  const createNotifications = jest.fn().mockResolvedValue({})
  const notificationModule = { createNotifications }

  const resolve = jest.fn((key: string) => {
    if (key === "logger") return logger
    if (key === Modules.NOTIFICATION) return notificationModule

    throw new Error(`Unexpected container key: ${key}`)
  })

  return { logger, createNotifications, container: { resolve } }
}

describe("sendPasswordResetEmail", () => {
  it("subscribes to the auth password-reset event", () => {
    expect(config.event).toBe("auth.password_reset")
  })

  it("sends a reset email with a link containing the token for a customer reset", async () => {
    const { createNotifications, container } = buildContainer()

    await sendPasswordResetEmail({
      event: {
        name: "auth.password_reset",
        data: { entity_id: "customer@example.com", actor_type: "customer", token: "reset-token-123" },
      },
      container: container as any,
    } as any)

    expect(createNotifications).toHaveBeenCalledTimes(1)
    const call = createNotifications.mock.calls[0][0]
    expect(call.to).toBe("customer@example.com")
    expect(call.channel).toBe("email")
    expect(call.content.text).toContain("reset-token-123")
    expect(call.content.html).toContain("reset-token-123")
  })

  it("ignores password resets for non-customer actors", async () => {
    const { createNotifications, container } = buildContainer()

    await sendPasswordResetEmail({
      event: {
        name: "auth.password_reset",
        data: { entity_id: "admin@example.com", actor_type: "user", token: "reset-token-456" },
      },
      container: container as any,
    } as any)

    expect(createNotifications).not.toHaveBeenCalled()
  })

  it("logs and swallows a notification failure instead of throwing", async () => {
    const { logger, createNotifications, container } = buildContainer()
    createNotifications.mockRejectedValue(new Error("smtp down"))

    await expect(
      sendPasswordResetEmail({
        event: {
          name: "auth.password_reset",
          data: { entity_id: "customer@example.com", actor_type: "customer", token: "t" },
        },
        container: container as any,
      } as any)
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("smtp down"))
  })
})
