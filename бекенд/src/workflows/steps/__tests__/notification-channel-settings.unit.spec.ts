import { configureNotificationChannel } from "../notification-channel-settings"

describe("notification channel configuration", () => {
  const input = {
    channel: "telegram" as const,
    credentials: { bot_token: "new-secret" },
  }

  it("keeps the previous version when verification fails", async () => {
    const replaceChannelCredentials = jest.fn()
    const container = {
      resolve: jest.fn().mockReturnValue({ replaceChannelCredentials }),
    }
    const verifier = {
      verify: jest.fn().mockRejectedValue(new Error("Telegram rejected token")),
    }

    await expect(
      configureNotificationChannel(container as never, input, verifier)
    ).rejects.toThrow("Telegram rejected token")
    expect(container.resolve).not.toHaveBeenCalled()
    expect(replaceChannelCredentials).not.toHaveBeenCalled()
  })

  it("persists a new version only after successful verification", async () => {
    const replacement = { channel: "telegram", version: 2, enabled: true }
    const replaceChannelCredentials = jest.fn().mockResolvedValue(replacement)
    const container = {
      resolve: jest.fn().mockReturnValue({ replaceChannelCredentials }),
    }
    const verifier = { verify: jest.fn().mockResolvedValue(undefined) }

    await expect(
      configureNotificationChannel(container as never, input, verifier)
    ).resolves.toBe(replacement)
    expect(verifier.verify).toHaveBeenCalledWith("telegram", input.credentials)
    expect(replaceChannelCredentials).toHaveBeenCalledWith(input)
  })
})
