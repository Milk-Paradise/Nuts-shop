import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  clearNotificationDeliveryAdapters,
  registerNotificationDeliveryAdapter,
} from "../delivery-adapter-registry"
import {
  previewAndTestNotification,
  smsPartCount,
  TEST_CHANNEL_UNAVAILABLE_REASON,
  TEST_SMS_LIMIT_REASON,
} from "../preview-test-service"

function buildContext(options: {
  channel?: "email" | "telegram" | "sms"
  setting?: Record<string, unknown> | null
  reserve?: boolean
  order?: Record<string, unknown>
} = {}) {
  const channel = options.channel ?? "email"
  let notification: Record<string, unknown> | null = null
  const service = {
    listNotificationChannelSettings: jest.fn().mockResolvedValue(
      options.setting === null
        ? []
        : [{
            id: "setting_1",
            channel,
            version: 1,
            enabled: true,
            verified_at: new Date(),
            revoked_at: null,
            daily_limit: 1,
            configuration: channel === "telegram" ? { seller_recipient: "chat_1" } : {},
            ...options.setting,
          }]
    ),
    retrieveRuntimeChannelCredentials: jest.fn().mockResolvedValue(
      channel === "email" ? { from: "seller@example.test" } : {}
    ),
    reserveSmsDailyLimit: jest.fn().mockResolvedValue(options.reserve ?? true),
    createNotificationOnce: jest.fn(async (input) => {
      notification = {
        id: "notification_1",
        state: "processing",
        created_at: new Date(),
        ...input,
      }
      return { notification, created: true }
    }),
    retrieveNotificationMessage: jest.fn(async () => notification),
    claimNotificationDeliveryLease: jest.fn().mockResolvedValue(true),
    listNotificationAttempts: jest.fn().mockResolvedValue([]),
    createNotificationAttempts: jest.fn().mockResolvedValue({ id: "attempt_1" }),
    updateNotificationAttempts: jest.fn().mockResolvedValue(undefined),
    transitionNotification: jest.fn(async (_id, _from, to, reason) => {
      notification = { ...notification, state: to, reason: reason ?? null }
      return notification
    }),
  }
  const graph = jest.fn().mockImplementation(({ entity }) => Promise.resolve({
    data: entity === "order"
      ? [options.order ?? {
          id: "order_1",
          display_id: 42,
          total: 1500,
          payment_status: "captured",
          items: [],
          shipping_address: { first_name: "Анна", last_name: "Иванова", city: "Москва", address_1: "Тверская, 1" },
          shipping_methods: [],
          fulfillments: [],
          payment_collections: [],
        }]
      : [],
  }))
  const logger = { error: jest.fn() }
  const container = {
    resolve: jest.fn((key) => {
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      return service
    }),
  }
  return { container, service, graph }
}

describe("notification preview and test service", () => {
  afterEach(() => clearNotificationDeliveryAdapters())

  it("renders order drafts through the shared renderer with production order data", async () => {
    const { container } = buildContext()
    const result = await previewAndTestNotification(container as never, {
      event: "order-confirmation",
      channel: "email",
      subject: "Заказ {{order_number}}",
      text: "{{customer_name}}: {{order_total}}",
      order_id: "order_1",
    })

    expect(result).toEqual({
      preview: { subject: "Заказ 42", text: "Анна Иванова: 1500" },
    })
  })

  it("uses the complete built-in example without unresolved variables", async () => {
    const { container, graph } = buildContext()
    const result = await previewAndTestNotification(container as never, {
      event: "order-confirmation",
      channel: "sms",
      text: "Заказ {{order_number}}, {{delivery_address}}, {{tracking_number}}",
      use_example: true,
    })

    expect(graph).not.toHaveBeenCalled()
    expect(result.preview.text).not.toContain("{{")
    expect(result.preview).toMatchObject({ sms_parts: smsPartCount(result.preview.text) })
  })

  it("records an unconfigured test as rejected and does not attempt delivery", async () => {
    const { container, service } = buildContext({ setting: null })
    const result = await previewAndTestNotification(container as never, {
      event: "seller-new-order",
      channel: "email",
      text: "Заказ {{order_number}}",
      use_example: true,
      send_test: true,
    })

    expect(result.test).toMatchObject({ sent: false, reason: TEST_CHANNEL_UNAVAILABLE_REASON })
    expect(service.createNotificationAttempts).not.toHaveBeenCalled()
    expect(service.createNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({ is_test: true, channel: "email" })
    )
  })

  it("rejects an SMS test with reason limit before creating an attempt", async () => {
    registerNotificationDeliveryAdapter("sms", {
      channel: "sms",
      deliver: jest.fn(),
      reconcileUnknown: jest.fn(),
    })
    const { container, service } = buildContext({ channel: "sms", reserve: false })
    const result = await previewAndTestNotification(container as never, {
      event: "order-confirmation",
      channel: "sms",
      text: "Заказ {{order_number}}",
      use_example: true,
      send_test: true,
      phone: "+7 (999) 123-45-67",
    })

    expect(service.reserveSmsDailyLimit).toHaveBeenCalledTimes(1)
    expect(service.createNotificationAttempts).not.toHaveBeenCalled()
    expect(result.test).toMatchObject({ sent: false, reason: TEST_SMS_LIMIT_REASON })
  })

  it("makes exactly one test attempt and marks its journal row", async () => {
    const deliver = jest.fn().mockResolvedValue({ classification: "success" })
    registerNotificationDeliveryAdapter("email", { channel: "email", deliver })
    const { container, service } = buildContext()
    const result = await previewAndTestNotification(container as never, {
      event: "seller-new-order",
      channel: "email",
      text: "Заказ {{order_number}}",
      use_example: true,
      send_test: true,
    })

    expect(result.test).toMatchObject({ sent: true })
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(service.createNotificationAttempts).toHaveBeenCalledTimes(1)
    expect(service.createNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({ is_test: true, recipient: "seller@example.test" })
    )
  })

  it("sends a Telegram test to the seller's bound chat", async () => {
    const deliver = jest.fn().mockResolvedValue({ classification: "success" })
    registerNotificationDeliveryAdapter("telegram", { channel: "telegram", deliver })
    const { container, service } = buildContext({ channel: "telegram" })
    const result = await previewAndTestNotification(container as never, {
      event: "seller-new-order",
      channel: "telegram",
      text: "Заказ {{order_number}}",
      use_example: true,
      send_test: true,
    })

    expect(result.test).toMatchObject({ sent: true })
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(service.createNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({ is_test: true, channel: "telegram", recipient: "chat_1" })
    )
  })

  it("never schedules an automatic retry after the single test attempt", async () => {
    registerNotificationDeliveryAdapter("email", {
      channel: "email",
      deliver: jest.fn().mockResolvedValue({ classification: "temporary_failure" }),
    })
    const { container, service } = buildContext()

    await previewAndTestNotification(container as never, {
      event: "seller-new-order",
      channel: "email",
      text: "Заказ {{order_number}}",
      use_example: true,
      send_test: true,
    })

    expect(service.createNotificationAttempts).toHaveBeenCalledTimes(1)
    expect(service.transitionNotification).toHaveBeenLastCalledWith(
      "notification_1",
      "retry_pending",
      "retries_exhausted",
      "test delivery is not retried",
      null
    )
  })
})
