import { createHash } from "node:crypto"

import { processSmscCallback } from "../process-smsc-callback"

const secret = "callback_secret"

function signature(id: string, phone: string, status: number) {
  return createHash("sha1")
    .update(`${id}:${phone}:${status}:${secret}`)
    .digest("hex")
}

function harness(callbackStatus?: number) {
  const service = {
    listNotificationChannelSettings: jest.fn().mockResolvedValue([
      { id: "setting_1", encrypted_credentials: "encrypted" },
    ]),
    retrieveRuntimeChannelCredentials: jest.fn().mockResolvedValue({
      login: "merchant",
      password: "password",
      callback_secret: secret,
    }),
    listNotificationAttempts: jest.fn().mockResolvedValue([
      {
        id: "attempt_1",
        notification_id: "notification_1",
        safe_diagnostics:
          callbackStatus === undefined ? {} : { callback_status: callbackStatus },
      },
    ]),
    retrieveNotificationMessage: jest.fn().mockResolvedValue({
      recipient: "+79991234567",
    }),
    updateNotificationAttempts: jest.fn().mockResolvedValue(undefined),
  }
  const locking = {
    execute: jest.fn(async (_key, operation) => operation()),
  }
  const container = {
    resolve: jest.fn((key: string) => (key === "locking" ? locking : service)),
  }
  return { container, locking, service }
}

describe("SMSC delivery callback", () => {
  const input = {
    id: "notification_1",
    phone: "79991234567",
    status: 1,
    sha1: signature("notification_1", "79991234567", 1),
    time: "08.10.26 12:00:00",
  }

  it("authenticates and records a delivery status", async () => {
    const { container, service } = harness()

    await expect(processSmscCallback(container as never, input)).resolves.toEqual({
      status: "processed",
    })
    expect(service.updateNotificationAttempts).toHaveBeenCalledWith({
      id: "attempt_1",
      safe_diagnostics: expect.objectContaining({ callback_status: 1 }),
    })
  })

  it("does not process the same status twice", async () => {
    const { container, service } = harness(1)

    await expect(processSmscCallback(container as never, input)).resolves.toEqual({
      status: "duplicate",
    })
    expect(service.updateNotificationAttempts).not.toHaveBeenCalled()
  })

  it("rejects a forged callback before looking up an attempt", async () => {
    const { container, service } = harness()

    await expect(
      processSmscCallback(container as never, { ...input, sha1: "0".repeat(40) })
    ).rejects.toThrow("Invalid SMSC callback signature")
    expect(service.updateNotificationAttempts).not.toHaveBeenCalled()
  })
})
