import type {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"

import type {
  CmsHomepage,
  NotificationTemplate,
  NotificationTemplatesSnapshot,
} from "../../lib/cms-content"
import { NOTIFICATION_TEMPLATE_VARIABLES } from "../../lib/cms-content"
import {
  CMS_HOMEPAGE_SNAPSHOT_KEY,
  CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY,
} from "../../lib/cms-snapshot"
import type CmsSnapshotModuleService from "../cms-snapshot/service"
import E2ENotificationService from "../notification-e2e/service"
import SmtpNotificationService, {
  createEmailDeliveryAdapter,
  type SmtpNotificationOptions,
} from "../notification-smtp/service"
import type NotificationDomainModuleService from "./service"
import {
  getNotificationDeliveryAdapter,
  registerNotificationDeliveryAdapter,
} from "./delivery-adapter-registry"
import {
  NotificationDeliveryExecutor,
  type NotificationForDelivery,
} from "./delivery-executor"
import { loadOrderNotificationData } from "./order-data"
import { renderNotification } from "./renderer"

type QueryGraph = Parameters<typeof loadOrderNotificationData>[0]

type InjectedDependencies = {
  logger: Logger
  query: QueryGraph
  notificationDomain: NotificationDomainModuleService
  cmsSnapshot: CmsSnapshotModuleService
}

type NotificationDomainProviderOptions = {
  channels?: string[]
  email:
    | { provider: "smtp"; options: SmtpNotificationOptions }
    | { provider: "e2e"; options: { base_url?: string } }
}

type EmailProvider = Pick<SmtpNotificationService, "send">

type DomainChannel = "email" | "telegram" | "sms"
type TemplateEvent = NotificationTemplate["event"]

type EventDescriptor = {
  key: string
  event: TemplateEvent
  type: string
  orderId?: string
  recipient: "customer" | "seller"
}

const RETURN_STAGES = {
  "Заказ отменён": { event: "order-canceled", stage: "canceled" },
  "Заявка на возврат получена": {
    event: "return-requested",
    stage: "requested",
  },
  "Возврат подтверждён": { event: "return-approved", stage: "approved" },
  "Заявка на возврат отклонена": {
    event: "return-rejected",
    stage: "rejected",
  },
} as const satisfies Record<
  string,
  { event: TemplateEvent; stage: string }
>

function requiredText(
  value: unknown,
  field: string,
  template: string
): string {
  if (typeof value !== "string" || !value) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Notification '${template}' requires data.${field}`
    )
  }
  return value
}

export function describeNotificationEvent(
  notification: ProviderSendNotificationDTO
): EventDescriptor {
  const data = notification.data ?? {}
  const template = notification.template
  if (template === "order-confirmation" || template === "order-payment-confirmed") {
    const orderId = requiredText(data.order_id, "order_id", template)
    return {
      key: `${template}:${orderId}`,
      event: template,
      type: template,
      orderId,
      recipient: "customer",
    }
  }
  if (template === "customer-password-reset") {
    const token = requiredText(data.token, "token", template)
    return {
      key: `${template}:${token}`,
      event: template,
      type: template,
      recipient: "customer",
    }
  }
  if (template === "abandoned-cart-reminder") {
    const cartId = requiredText(data.cart_id, "cart_id", template)
    return {
      key: `${template}:${cartId}`,
      event: template,
      type: template,
      recipient: "customer",
    }
  }
  if (template === "shipping-return-status") {
    const orderId = requiredText(data.order_id, "order_id", template)
    const subject = notification.content?.subject
    const stage =
      typeof subject === "string"
        ? RETURN_STAGES[subject as keyof typeof RETURN_STAGES]
        : undefined
    if (!stage) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Notification '${template}' has an unsupported fixed subject`
      )
    }
    const decision =
      typeof data.decision === "string" && data.decision
        ? data.decision
        : "none"
    return {
      key: `${template}:${orderId}:${decision}:${stage.stage}`,
      event: stage.event,
      type: template,
      orderId,
      recipient: "customer",
    }
  }
  if (template === "seller-new-order" || template === "seller-return-request") {
    const orderId = requiredText(data.order_id, "order_id", template)
    const eventIdentity =
      template === "seller-return-request" && typeof data.return_request_id === "string"
        ? `${orderId}:${data.return_request_id}`
        : orderId
    return {
      key: `${template}:${eventIdentity}`,
      event: template,
      type: template,
      orderId,
      recipient: "seller",
    }
  }
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `Unsupported notification template '${template}'`
  )
}

function fallbackContent(notification: ProviderSendNotificationDTO) {
  return {
    subject: notification.content?.subject ?? null,
    text: notification.content?.text ?? "",
    html: notification.content?.html ?? null,
  }
}

function firstUrl(value: string | null | undefined, marker?: string) {
  if (!value) return null
  const urls = value.match(/https?:\/\/[^\s<\"]+/g) ?? []
  if (!marker) return urls[0]?.replace(/[.,]$/, "") ?? null
  return urls.find((url) => url.includes(marker))?.replace(/[.,]$/, "") ?? null
}

function templateVariables(
  notification: ProviderSendNotificationDTO,
  loadedOrder?: Awaited<ReturnType<typeof loadOrderNotificationData>>
) {
  const data = notification.data ?? {}
  const order = loadedOrder?.order ?? {}
  const text = notification.content?.text
  return {
    ...data,
    order_number: order.number,
    order_total: order.total,
    payment_status: order.payment_status,
    delivery_address: order.delivery_address,
    pickup_point_address: order.pickup_address,
    tracking_number: order.tracking_number,
    reset_url: firstUrl(text),
    expires_in_minutes: 15,
    checkout_url: firstUrl(text, "/cart?"),
    unsubscribe_url: firstUrl(text, "/unsubscribe/"),
    return_status: notification.content?.subject,
    return_tracking_number: data.return_tracking_number,
  }
}

function templateFor(
  snapshot: NotificationTemplatesSnapshot | null,
  event: TemplateEvent,
  channel: DomainChannel,
  recipient: "customer" | "seller"
) {
  return snapshot?.templates.find(
    (candidate) =>
      candidate.event === event &&
      candidate.channel === channel &&
      candidate.recipient === recipient
  )
}

function normalizeRussianPhone(value: unknown) {
  if (typeof value !== "string") return null
  const digits = value.replace(/\D/g, "")
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`
  }
  if (digits.length === 10 && digits.startsWith("9")) return `+7${digits}`
  return null
}

class NotificationDomainProviderService extends AbstractNotificationProviderService {
  static identifier = "domain"

  private readonly emailProvider_: EmailProvider

  constructor(
    private readonly dependencies_: InjectedDependencies,
    options: NotificationDomainProviderOptions
  ) {
    super()
    this.emailProvider_ =
      options.email.provider === "e2e"
        ? new E2ENotificationService(
            { logger: dependencies_.logger },
            options.email.options
          )
        : new SmtpNotificationService(
            { logger: dependencies_.logger },
            options.email.options
          )
    registerNotificationDeliveryAdapter(
      "email",
      createEmailDeliveryAdapter({
        provider: this.emailProvider_,
        listChannelSettings: () =>
          dependencies_.notificationDomain.listNotificationChannelSettings(
            { channel: "email" },
            { order: { version: "DESC" } }
          ) as never,
        retrieveRuntimeChannelCredentials: (versionId) =>
          dependencies_.notificationDomain.retrieveRuntimeChannelCredentials(
            versionId
          ),
        readCompanyName: async () => {
          const [record] = await dependencies_.cmsSnapshot.listCmsSnapshots({
            key: CMS_HOMEPAGE_SNAPSHOT_KEY,
          })
          const homepage = record?.payload as CmsHomepage | undefined
          return homepage?.settings.companyName ?? null
        },
        defaultFrom:
          options.email.provider === "smtp"
            ? options.email.options.from
            : "notification-e2e@example.test",
        classifyErrors: options.email.provider === "smtp",
      })
    )
  }

  /** Initial-delivery hook shared with AIL-169; absent channel adapters are deferred. */
  protected async executeCreatedNotification(notificationId: string) {
    const notification = (await this.dependencies_.notificationDomain
      .retrieveNotificationMessage(notificationId)) as NotificationForDelivery
    if (notification.channel === "none") return
    const adapter = getNotificationDeliveryAdapter(notification.channel)
    if (!adapter) return
    const executor = new NotificationDeliveryExecutor(
      this.dependencies_.notificationDomain,
      this.dependencies_.logger
    )
    await executor.execute(notificationId, adapter)
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const descriptor = describeNotificationEvent(notification)
    const [previous] =
      await this.dependencies_.notificationDomain.listNotificationMessages({
        event_key: descriptor.key,
        type: descriptor.type,
      })
    if (previous) return { id: previous.id }

    const [snapshotRecord, loadedOrder, settings] = await Promise.all([
      this.dependencies_.cmsSnapshot
        .listCmsSnapshots({ key: CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY })
        .then((records) => records[0] ?? null),
      descriptor.orderId
        ? loadOrderNotificationData(this.dependencies_.query, descriptor.orderId)
        : Promise.resolve(undefined),
      this.dependencies_.notificationDomain.listNotificationChannelSettings(
        {},
        { order: { version: "DESC" } }
      ),
    ])
    const snapshot =
      (snapshotRecord?.payload as NotificationTemplatesSnapshot | undefined) ??
      null
    const latestSettings = new Map<string, (typeof settings)[number]>()
    for (const setting of settings) {
      if (!latestSettings.has(setting.channel)) {
        latestSettings.set(setting.channel, setting)
      }
    }

    const accountId =
      typeof notification.data?.customer_id === "string"
        ? notification.data.customer_id
        : typeof loadedOrder?.order.customer_id === "string"
          ? loadedOrder.order.customer_id
          : null
    const [binding] = descriptor.recipient === "customer" && accountId
      ? await this.dependencies_.notificationDomain.listTelegramBindings({
          account_id: accountId,
          state: "active",
        })
      : []
    const candidates: Array<{ channel: DomainChannel; recipient: string }> = []
    if (descriptor.recipient === "seller") {
      for (const channel of ["email", "telegram"] as const) {
        const setting = latestSettings.get(channel)
        const recipient = setting?.configuration?.seller_recipient
        if (
          setting?.enabled &&
          !setting.revoked_at &&
          typeof recipient === "string" &&
          recipient.trim()
        ) {
          candidates.push({ channel, recipient: recipient.trim() })
        }
      }
      if (!candidates.length) {
        const result =
          await this.dependencies_.notificationDomain.createNotificationOnce({
            event_key: descriptor.key,
            type: descriptor.type,
            recipient: "seller",
            channel: "none",
            reason: "не настроен канал продавца",
            template_key: null,
            template_revision: null,
            text_origin: "fallback",
            content: fallbackContent(notification),
          })
        if (result.created) {
          await this.dependencies_.notificationDomain.transitionNotification(
            result.notification.id,
            "processing",
            "permanently_rejected",
            "не настроен канал продавца"
          )
        }
        return { id: result.notification.id }
      }
    } else {
      const rawPhone = loadedOrder?.order.phone
      const phone = normalizeRussianPhone(rawPhone)
      candidates.push({ channel: "email", recipient: notification.to })
      if (latestSettings.get("telegram")?.enabled && binding?.chat_id) {
        candidates.push({ channel: "telegram", recipient: binding.chat_id })
      }
      if (latestSettings.get("sms")?.enabled && phone) {
        candidates.push({ channel: "sms", recipient: phone })
      } else if (latestSettings.get("sms")?.enabled) {
        const rejected =
          await this.dependencies_.notificationDomain.createNotificationOnce({
            event_key: descriptor.key,
            type: descriptor.type,
            recipient: typeof rawPhone === "string" ? rawPhone : "",
            channel: "sms",
            reason: "phone",
            template_key: null,
            template_revision: null,
            text_origin: "fallback",
            content: fallbackContent(notification),
          })
        if (rejected.created) {
          await this.dependencies_.notificationDomain.transitionNotification(
            rejected.notification.id,
            "processing",
            "permanently_rejected",
            "phone"
          )
        }
      }
    }

    const created: Array<{ id: string }> = []
    for (const candidate of candidates) {
      const template = templateFor(
        snapshot,
        descriptor.event,
        candidate.channel,
        descriptor.recipient
      )
      if (template && !template.enabled) {
        if (candidate.channel === "email") {
          const skipped =
            await this.dependencies_.notificationDomain.createNotificationOnce({
              event_key: descriptor.key,
              type: descriptor.type,
              recipient: notification.to,
              channel: "none",
              reason: "шаблон отключён",
              template_key: template.documentId,
              template_revision: snapshot?.revision ?? null,
              text_origin: "fallback",
              content: fallbackContent(notification),
            })
          if (skipped.created) {
            await this.dependencies_.notificationDomain.transitionNotification(
              skipped.notification.id,
              "processing",
              "permanently_rejected",
              "шаблон отключён"
            )
          }
        }
        continue
      }
      // SMS is opt-in twice: both its channel and a concrete enabled template.
      if (candidate.channel === "sms" && !template) continue
      const content = template
        ? renderNotification(
            { subject: template.subject, text: template.body },
            templateVariables(notification, loadedOrder),
            { required: NOTIFICATION_TEMPLATE_VARIABLES[template.event].required }
          )
        : fallbackContent(notification)
      const storedContent = {
        ...content,
        ...notification.data,
        ...(descriptor.orderId
          ? {
              order_id: descriptor.orderId,
              display_id: loadedOrder?.order.number ?? null,
            }
          : {}),
      }
      const result =
        await this.dependencies_.notificationDomain.createNotificationOnce({
          event_key: descriptor.key,
          type: descriptor.type,
          recipient: candidate.recipient,
          channel: candidate.channel,
          template_key: template?.documentId ?? null,
          template_revision: template ? snapshot?.revision ?? null : null,
          text_origin: template ? "template" : "fallback",
          content: storedContent,
        })
      if (!result.created) continue
      created.push({ id: result.notification.id })
    }

    await Promise.allSettled(
      created.map((message) => this.executeCreatedNotification(message.id))
    )

    return { id: created[0]?.id }
  }
}

export default NotificationDomainProviderService
