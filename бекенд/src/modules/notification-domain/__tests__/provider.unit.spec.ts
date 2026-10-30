import type { ProviderSendNotificationDTO } from "@medusajs/framework/types"

import NotificationDomainProviderService, {
  describeNotificationEvent,
} from "../provider"
import SmtpNotificationService from "../../notification-smtp/service"

const emailSend = jest
  .spyOn(SmtpNotificationService.prototype, "send")
  .mockResolvedValue({ id: "mail_1" })

class TestNotificationDomainProviderService extends NotificationDomainProviderService {
  readonly executeMock = jest.fn().mockResolvedValue(undefined)

  protected override async executeCreatedNotification(notificationId: string) {
    await this.executeMock(notificationId)
  }
}

const order = {
  id: "order_1",
  display_id: 42,
  customer_id: "cus_1",
  email: "buyer@example.test",
  currency_code: "rub",
  total: 1200,
  payment_status: "captured",
  metadata: {},
  items: [],
  shipping_address: { phone: "+7 (999) 111-22-33", city: "Москва" },
  shipping_methods: [],
  fulfillments: [],
  payment_collections: [],
}

function notification(
  overrides: Partial<ProviderSendNotificationDTO> = {}
): ProviderSendNotificationDTO {
  return {
    to: "buyer@example.test",
    channel: "email",
    template: "order-confirmation",
    data: { order_id: "order_1", display_id: 42 },
    content: { subject: "Заказ №42 принят", text: "Заказ №42 принят." },
    ...overrides,
  }
}

function buildProvider(options: {
  templates?: Array<Record<string, unknown>>
  settings?: Array<Record<string, unknown>>
  binding?: Record<string, unknown> | null
  phone?: unknown
} = {}) {
  const identities = new Map<string, Record<string, unknown>>()
  const createNotificationOnce = jest.fn(async (input: Record<string, unknown>) => {
    const identity = [input.event_key, input.type, input.recipient, input.channel].join("|")
    const existing = identities.get(identity)
    if (existing) return { notification: existing, created: false as const }
    const stored = { id: `msg_${identities.size + 1}`, ...input }
    identities.set(identity, stored)
    return { notification: stored, created: true as const }
  })
  const notificationDomain = {
    createNotificationOnce,
    listNotificationMessages: jest.fn(async (filters: Record<string, unknown>) =>
      [...identities.values()].filter(
        (message) =>
          message.event_key === filters.event_key && message.type === filters.type
      )
    ),
    transitionNotification: jest.fn().mockResolvedValue(undefined),
    listNotificationChannelSettings: jest.fn().mockResolvedValue(options.settings ?? []),
    listTelegramBindings: jest
      .fn()
      .mockResolvedValue(options.binding ? [options.binding] : []),
  }
  const cmsSnapshot = {
    listCmsSnapshots: jest.fn().mockResolvedValue(
      options.templates
        ? [{ payload: { revision: "rev_1", templates: options.templates } }]
        : []
    ),
  }
  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) => ({
      data:
        entity === "order"
          ? [
              {
                ...order,
                shipping_address: {
                  ...order.shipping_address,
                  ...(options.phone === undefined ? {} : { phone: options.phone }),
                },
              },
            ]
          : [],
    })),
  }
  const provider = new TestNotificationDomainProviderService(
    {
      logger: { error: jest.fn() } as never,
      query,
      notificationDomain: notificationDomain as never,
      cmsSnapshot: cmsSnapshot as never,
    },
    { email: { provider: "smtp", options: {} } }
  )
  return {
    provider,
    createNotificationOnce,
    execute: provider.executeMock,
    notificationDomain,
  }
}

const emailTemplate = {
  documentId: "tpl_order_email",
  updatedAt: "2026-10-08T00:00:00.000Z",
  event: "order-confirmation",
  channel: "email",
  recipient: "customer",
  subject: "Заказ №{{order_number}}",
  body: "Сумма {{order_total}}",
  language: "ru",
  enabled: true,
  mandatory: true,
}

describe("NotificationDomainProviderService", () => {
  beforeEach(() => {
    emailSend.mockClear().mockResolvedValue({ id: "mail_1" })
  })

  it("deduplicates repeated processing per routed channel", async () => {
    const { provider, createNotificationOnce, execute, notificationDomain } = buildProvider({
      templates: [emailTemplate],
    })

    await provider.send(notification())
    await provider.send(notification())

    expect(createNotificationOnce).toHaveBeenCalledTimes(1)
    expect(emailSend).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith("msg_1")
    expect(createNotificationOnce.mock.calls[0][0]).toMatchObject({
      event_key: "order-confirmation:order_1",
      channel: "email",
      content: { order_id: "order_1", display_id: 42 },
    })
  })

  it("uses different event keys for two return stages of one order", () => {
    const requested = describeNotificationEvent(
      notification({
        template: "shipping-return-status",
        data: { order_id: "order_1" },
        content: { subject: "Заявка на возврат получена", text: "Получена" },
      })
    )
    const approved = describeNotificationEvent(
      notification({
        template: "shipping-return-status",
        data: { order_id: "order_1", decision: "approved" },
        content: { subject: "Возврат подтверждён", text: "Подтверждён" },
      })
    )

    expect(requested.key).toBe(
      "shipping-return-status:order_1:none:requested"
    )
    expect(approved.key).toBe(
      "shipping-return-status:order_1:approved:approved"
    )
  })

  it("does not restore a disabled reminder and creates only a later event after enabling", async () => {
    const disabled = {
      ...emailTemplate,
      documentId: "tpl_cart_email",
      event: "abandoned-cart-reminder",
      subject: "Корзина ждёт",
      body: "Вернитесь к оформлению",
      enabled: false,
      mandatory: false,
    }
    const harness = buildProvider({ templates: [disabled] })
    const first = notification({
      template: "abandoned-cart-reminder",
      data: { cart_id: "cart_old" },
    })
    await harness.provider.send(first)
    expect(harness.createNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "none", reason: "шаблон отключён" })
    )

    disabled.enabled = true
    await harness.provider.send(first)
    expect(harness.createNotificationOnce).toHaveBeenCalledTimes(1)

    await harness.provider.send(
      notification({
        template: "abandoned-cart-reminder",
        data: { cart_id: "cart_new" },
      })
    )
    expect(harness.createNotificationOnce).toHaveBeenLastCalledWith(
      expect.objectContaining({ event_key: "abandoned-cart-reminder:cart_new" })
    )
  })

  it("stores initiator content with fallback origin when no template exists", async () => {
    const { provider, createNotificationOnce } = buildProvider()
    await provider.send(notification())

    expect(createNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        text_origin: "fallback",
        template_key: null,
        content: expect.objectContaining({
          subject: "Заказ №42 принят",
          text: "Заказ №42 принят.",
        }),
      })
    )
  })

  it("renders real checkout and unsubscribe links into a published abandoned-cart template", async () => {
    const template = {
      ...emailTemplate,
      documentId: "tpl_cart_email",
      event: "abandoned-cart-reminder",
      subject: "Корзина ждёт",
      body: "Оформить: {{checkout_url}} Отписаться: {{unsubscribe_url}}",
    }
    const { provider, createNotificationOnce } = buildProvider({ templates: [template] })

    await provider.send(notification({
      template: "abandoned-cart-reminder",
      data: { cart_id: "cart_1" },
      content: {
        subject: "Корзина ждёт",
        text: "Оформить: https://shop.test/cart?cart_id=cart_1 Отписаться: https://shop.test/unsubscribe/abandoned-cart?customer_id=cus_1",
      },
    }))

    expect(createNotificationOnce).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({
        text: "Оформить: https://shop.test/cart?cart_id=cart_1 Отписаться: https://shop.test/unsubscribe/abandoned-cart?customer_id=cus_1",
      }),
    }))
  })

  it("rejects a published abandoned-cart template when its required checkout link is absent", async () => {
    const template = {
      ...emailTemplate,
      documentId: "tpl_cart_email",
      event: "abandoned-cart-reminder",
      subject: "Корзина ждёт",
      body: "Оформить: {{checkout_url}} Отписаться: {{unsubscribe_url}}",
    }
    const { provider, createNotificationOnce } = buildProvider({ templates: [template] })

    await expect(provider.send(notification({
      template: "abandoned-cart-reminder",
      data: { cart_id: "cart_1" },
      content: {
        subject: "Корзина ждёт",
        text: "Отписаться: https://shop.test/unsubscribe/abandoned-cart?customer_id=cus_1",
      },
    }))).rejects.toThrow("Notification required variable 'checkout_url' is empty")
    expect(createNotificationOnce).not.toHaveBeenCalled()
  })

  it("starts the first email attempt through the common executor immediately", async () => {
    const { provider, execute } = buildProvider()

    await provider.send(notification())

    expect(execute).toHaveBeenCalledWith("msg_1")
    expect(emailSend).not.toHaveBeenCalled()
  })

  it("routes a new store to email only", async () => {
    const { provider, createNotificationOnce } = buildProvider()
    await provider.send(notification())

    expect(createNotificationOnce).toHaveBeenCalledTimes(1)
    expect(createNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", recipient: "buyer@example.test" })
    )
    expect(emailSend).not.toHaveBeenCalled()
  })

  it("adds Telegram only for an active binding and SMS only with channel and template", async () => {
    const telegramTemplate = {
      ...emailTemplate,
      documentId: "tpl_order_telegram",
      channel: "telegram",
      subject: null,
    }
    const smsTemplate = {
      ...emailTemplate,
      documentId: "tpl_order_sms",
      channel: "sms",
      subject: null,
    }
    const { provider, createNotificationOnce } = buildProvider({
      templates: [emailTemplate, telegramTemplate, smsTemplate],
      settings: [
        { channel: "telegram", enabled: true, version: 1 },
        { channel: "sms", enabled: true, version: 1 },
      ],
      binding: { account_id: "cus_1", chat_id: "chat_1", state: "active" },
    })
    await provider.send(notification())

    expect(createNotificationOnce.mock.calls.map(([input]) => input.channel)).toEqual([
      "email",
      "telegram",
      "sms",
    ])
    expect(createNotificationOnce.mock.calls[2][0]).toMatchObject({
      recipient: "+79991112233",
    })
    expect(provider.executeMock.mock.calls.map(([id]) => id)).toEqual([
      "msg_1",
      "msg_2",
      "msg_3",
    ])
    expect(emailSend).not.toHaveBeenCalled()
  })

  it("records an invalid SMS phone as permanently rejected without executing it", async () => {
    const { provider, createNotificationOnce, execute, notificationDomain } = buildProvider({
      settings: [{ channel: "sms", enabled: true, version: 1 }],
      phone: "+375291234567",
    })

    await provider.send(notification())

    expect(createNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "sms",
        recipient: "+375291234567",
        reason: "phone",
      })
    )
    expect(notificationDomain.transitionNotification).toHaveBeenCalledWith(
      "msg_1",
      "processing",
      "permanently_rejected",
      "phone"
    )
    expect(execute).toHaveBeenCalledWith("msg_2")
    expect(execute).not.toHaveBeenCalledWith("msg_1")
  })

  it("routes a seller notification to configured email and Telegram recipients", async () => {
    const sellerEmailTemplate = {
      ...emailTemplate,
      documentId: "tpl_seller_order_email",
      event: "seller-new-order",
      recipient: "seller",
    }
    const sellerTelegramTemplate = {
      ...sellerEmailTemplate,
      documentId: "tpl_seller_order_telegram",
      channel: "telegram",
      subject: null,
    }
    const { provider, createNotificationOnce, execute } = buildProvider({
      templates: [sellerEmailTemplate, sellerTelegramTemplate],
      settings: [
        {
          channel: "email",
          enabled: true,
          version: 1,
          configuration: { seller_recipient: "seller@example.test" },
        },
        {
          channel: "telegram",
          enabled: true,
          version: 1,
          configuration: { seller_recipient: "chat_seller" },
        },
      ],
    })

    await provider.send(
      notification({
        to: "seller",
        template: "seller-new-order",
        data: { order_id: "order_1" },
        content: { subject: "Новый заказ", text: "Получен новый заказ." },
      })
    )

    expect(createNotificationOnce.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        event_key: "seller-new-order:order_1",
        channel: "email",
        recipient: "seller@example.test",
      }),
      expect.objectContaining({
        event_key: "seller-new-order:order_1",
        channel: "telegram",
        recipient: "chat_seller",
      }),
    ])
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it("records one permanently rejected seller notification without channels", async () => {
    const { provider, createNotificationOnce, notificationDomain, execute } =
      buildProvider()

    const result = await provider.send(
      notification({
        to: "seller",
        template: "seller-new-order",
        data: { order_id: "order_1" },
        content: { subject: "Новый заказ", text: "Получен новый заказ." },
      })
    )

    expect(createNotificationOnce).toHaveBeenCalledTimes(1)
    expect(createNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: "seller",
        channel: "none",
        reason: "не настроен канал продавца",
      })
    )
    expect(notificationDomain.transitionNotification).toHaveBeenCalledWith(
      "msg_1",
      "processing",
      "permanently_rejected",
      "не настроен канал продавца"
    )
    expect(execute).not.toHaveBeenCalled()
    expect(result).toEqual({ id: "msg_1" })
  })

  it("uses the return request id to deduplicate seller return notifications", () => {
    const descriptor = describeNotificationEvent(
      notification({
        template: "seller-return-request",
        data: { order_id: "order_1", return_request_id: "return_1" },
      })
    )

    expect(descriptor).toMatchObject({
      key: "seller-return-request:order_1:return_1",
      event: "seller-return-request",
      recipient: "seller",
    })
  })
})
