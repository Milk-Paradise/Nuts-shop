import {
  SMS_MAX_LENGTH,
  SmscDeliveryAdapter,
  normalizeRussianPhone,
} from "../smsc-adapter"

const VERSION_ID = "setting_sms_v2"

function harness() {
  const service = {
    listNotificationChannelSettings: jest.fn().mockResolvedValue([
      {
        id: VERSION_ID,
        channel: "sms",
        version: 2,
        enabled: true,
        revoked_at: null,
      },
    ]),
    retrieveRuntimeChannelCredentials: jest.fn().mockResolvedValue({
      login: "merchant",
      password: "secret",
      sender: "Shop",
    }),
  }
  const client = {
    send: jest.fn().mockResolvedValue({ id: "notification_1", cnt: 3 }),
    status: jest.fn().mockResolvedValue({ status: -3 }),
  }
  const adapter = new SmscDeliveryAdapter(service as never, client as never)
  const input = (overrides: Record<string, unknown> = {}) => ({
    notification: {
      id: "notification_1",
      type: "order-confirmation",
      recipient: "+79991234567",
      channel: "sms" as const,
      state: "processing" as const,
      content: { body: "Заказ создан" },
      created_at: new Date(),
    },
    attempt_number: 1,
    external_id: "notification_1",
    ...overrides,
  })
  return { adapter, client, input, service }
}

describe("SMSC delivery adapter", () => {
  it.each([
    ["89991234567", "+79991234567"],
    ["79991234567", "+79991234567"],
    ["+79991234567", "+79991234567"],
    ["9991234567", "+79991234567"],
  ])("normalizes %s to %s", (source, expected) => {
    expect(normalizeRussianPhone(source)).toBe(expected)
  })

  it("rejects a foreign phone permanently without reading credentials", async () => {
    const { adapter, client, input, service } = harness()

    await expect(
      adapter.deliver(
        input({
          notification: {
            ...input().notification,
            recipient: "+375291234567",
          },
        })
      )
    ).resolves.toEqual({
      classification: "permanent_failure",
      safe_diagnostics: { reason: "phone" },
    })
    expect(client.send).not.toHaveBeenCalled()
    expect(service.retrieveRuntimeChannelCredentials).not.toHaveBeenCalled()
  })

  it("sends 201 characters and pins the channel setting version", async () => {
    const { adapter, client, input } = harness()
    const body = "я".repeat(SMS_MAX_LENGTH)

    await expect(
      adapter.deliver(
        input({ notification: { ...input().notification, content: { body } } })
      )
    ).resolves.toMatchObject({
      classification: "success",
      channel_setting_version_id: VERSION_ID,
    })
    expect(client.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: body })
    )
  })

  it("rejects 202 characters with the length reason", async () => {
    const { adapter, client, input } = harness()

    await expect(
      adapter.deliver(
        input({
          notification: {
            ...input().notification,
            content: { body: "я".repeat(SMS_MAX_LENGTH + 1) },
          },
        })
      )
    ).resolves.toEqual({
      classification: "permanent_failure",
      safe_diagnostics: { reason: "length" },
    })
    expect(client.send).not.toHaveBeenCalled()
  })

  it("checks an unknown prior outcome before retrying with the same id", async () => {
    const { adapter, client, input } = harness()

    await adapter.deliver(input({ attempt_number: 2 }))

    expect(client.status).toHaveBeenCalledWith(
      expect.anything(),
      { id: "notification_1", phone: "+79991234567" }
    )
    expect(client.status.mock.invocationCallOrder[0]).toBeLessThan(
      client.send.mock.invocationCallOrder[0]
    )
    expect(client.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "notification_1" })
    )
  })

  it("does not resend when reconciliation finds the message", async () => {
    const { adapter, client, input } = harness()
    client.status.mockResolvedValue({ status: 0 })

    await expect(adapter.deliver(input({ attempt_number: 2 }))).resolves.toMatchObject({
      classification: "success",
      channel_setting_version_id: VERSION_ID,
    })
    expect(client.send).not.toHaveBeenCalled()
  })

  it.each([{}, { id: "notification_1" }])(
    "keeps an incomplete reconciliation response unknown: %j",
    async (response) => {
      const { adapter, client, input } = harness()
      client.status.mockResolvedValue(response)

      await expect(adapter.reconcileUnknown(input())).resolves.toMatchObject({
        classification: "unknown",
        safe_diagnostics: { incomplete_response: true, provider_status: null },
        channel_setting_version_id: VERSION_ID,
      })
    }
  )

  it("keeps the credential version pinned while reconciling an unknown send", async () => {
    const { adapter, client, input, service } = harness()
    client.send.mockRejectedValue(new TypeError("network failed"))
    client.status.mockResolvedValue({ status: 0 })

    await expect(adapter.deliver(input())).resolves.toMatchObject({
      classification: "unknown",
      channel_setting_version_id: VERSION_ID,
    })
    await expect(adapter.reconcileUnknown(input())).resolves.toMatchObject({
      classification: "success",
      channel_setting_version_id: VERSION_ID,
    })
    expect(service.retrieveRuntimeChannelCredentials).toHaveBeenCalledTimes(1)
  })
})
