import { randomUUID } from "node:crypto"
import type { Context } from "@medusajs/framework/types"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"

import NotificationAttempt from "./models/notification-attempt"
import NotificationChannelSetting from "./models/notification-channel-setting"
import NotificationMessage from "./models/notification-message"
import SmsDailyCounter from "./models/sms-daily-counter"
import TelegramBinding from "./models/telegram-binding"
import {
  assertNotificationTransition,
  type NotificationState,
} from "./state-machine"
import {
  type ConfigureNotificationChannelInput,
  type NotificationChannel,
  type NotificationChannelSettingRecord,
  serializeNotificationChannelSetting,
} from "./channel-settings"
import {
  decryptNotificationCredentials,
  encryptNotificationCredentials,
} from "./credentials"
import { registerNotificationDeliveryAdapter } from "./delivery-adapter-registry"
import { SmscDeliveryAdapter } from "./smsc-adapter"
import { TelegramDeliveryAdapter } from "./telegram-delivery-adapter"
import { NOTIFICATION_DELIVERY_LEASE_MS } from "./delivery-policy"

const CHANNEL_DISABLED_REASON = "канал отключён"
const CUSTOMER_DISABLED_REASON = "покупатель отключил канал"
export const SELLER_TELEGRAM_BINDING_ACCOUNT_ID = "seller-notification-recipient"

type TelegramBindingRecord = {
  id: string
  account_id: string
  chat_id: string | null
  username: string | null
  display_name: string | null
  state: "pending" | "active" | "disabled"
  token_hash: string | null
  token_expires_at: Date | null
  token_used_at: Date | null
}

type TransactionManager = {
  getConnection(): {
    execute(query: string, parameters?: unknown[]): Promise<unknown>
  }
}

type CreateNotificationInput = {
  event_key: string
  type: string
  recipient: string
  channel: "email" | "telegram" | "sms" | "none"
  reason?: string | null
  template_key?: string | null
  template_revision?: string | null
  text_origin: "template" | "fallback"
  is_test?: boolean
  content: Record<string, unknown>
}

class NotificationDomainModuleService extends MedusaService({
  NotificationMessage,
  NotificationAttempt,
  NotificationChannelSetting,
  TelegramBinding,
  SmsDailyCounter,
}) {
  // Адаптеры каналов регистрируются здесь, а не загрузчиком модуля: загрузчики
  // Medusa выполняются до регистрации сервиса модуля и не могут его получить.
  constructor(...args: ConstructorParameters<ReturnType<typeof MedusaService>>) {
    super(...args)
    registerNotificationDeliveryAdapter("telegram", new TelegramDeliveryAdapter(this))
    registerNotificationDeliveryAdapter("sms", new SmscDeliveryAdapter(this))
  }

  @InjectTransactionManager()
  // The conditional upsert must share one transaction to enforce the limit.
  // eslint-disable-next-line @medusajs/use-inject-manager-on-public-methods
  async reserveSmsDailyLimit(
    calendarDate: string,
    timezone: string,
    limit: number,
    @MedusaContext() sharedContext: Context = {}
  ) {
    if (!Number.isSafeInteger(limit) || limit <= 0) return false
    const manager = sharedContext.transactionManager as TransactionManager
    const rows = (await manager.getConnection().execute(
      `insert into "notification_sms_daily_counter"
        ("id", "calendar_date", "timezone", "count")
       values (?, ?, ?, 1)
       on conflict ("calendar_date", "timezone") where "deleted_at" is null
       do update set "count" = "notification_sms_daily_counter"."count" + 1,
         "updated_at" = now()
       where "notification_sms_daily_counter"."count" < ?
       returning "count"`,
      [`sms_${randomUUID()}`, calendarDate, timezone, limit]
    )) as unknown[]
    return rows.length === 1
  }

  async getTelegramBindingStatus(accountId: string) {
    const [[binding], [setting]] = await Promise.all([
      this.listTelegramBindings({ account_id: accountId }) as Promise<
        TelegramBindingRecord[]
      >,
      this.listNotificationChannelSettings(
        { channel: "telegram" },
        { order: { version: "DESC" }, take: 1 }
      ) as Promise<NotificationChannelSettingRecord[]>,
    ])

    return {
      available: Boolean(setting?.enabled && !setting.revoked_at),
      connected: binding?.state === "active" && Boolean(binding.chat_id),
      state: binding?.state ?? "disabled",
      username: binding?.username ?? null,
      display_name: binding?.display_name ?? null,
    }
  }

  @InjectManager()
  async issueTelegramBindingToken(
    accountId: string,
    tokenHash: string,
    expiresAt: Date,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const [binding] = (await this.listTelegramBindings(
      { account_id: accountId },
      {},
      sharedContext
    )) as TelegramBindingRecord[]

    if (binding) {
      return this.updateTelegramBindings(
        {
          id: binding.id,
          token_hash: tokenHash,
          token_expires_at: expiresAt,
          token_used_at: null,
          state: binding.state === "active" ? "active" : "pending",
        },
        sharedContext
      )
    }

    return this.createTelegramBindings(
      {
        account_id: accountId,
        state: "pending",
        token_hash: tokenHash,
        token_expires_at: expiresAt,
        token_used_at: null,
        chat_id: null,
      },
      sharedContext
    )
  }

  @InjectManager()
  async consumeTelegramBindingToken(
    tokenHash: string,
    chatId: string,
    now: Date,
    username: string | null = null,
    displayName: string | null = null,
    @MedusaContext() sharedContext: Context = {}
  ) {
    return this.consumeTelegramBindingToken_(
      tokenHash,
      chatId,
      now,
      username,
      displayName,
      sharedContext
    )
  }

  @InjectTransactionManager()
  protected async consumeTelegramBindingToken_(
    tokenHash: string,
    chatId: string,
    now: Date,
    username: string | null,
    displayName: string | null,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const [binding] = (await this.listTelegramBindings(
      { token_hash: tokenHash },
      {},
      sharedContext
    )) as TelegramBindingRecord[]

    if (!binding) return { status: "rejected" as const, reason: "invalid_token" }
    if (binding.token_used_at) {
      return { status: "rejected" as const, reason: "token_already_used" }
    }
    if (!binding.token_expires_at || binding.token_expires_at.getTime() <= now.getTime()) {
      return { status: "rejected" as const, reason: "token_expired" }
    }

    if (binding.account_id === SELLER_TELEGRAM_BINDING_ACCOUNT_ID) {
      const [setting] = (await this.listNotificationChannelSettings(
        { channel: "telegram" },
        { order: { version: "DESC" }, take: 1 },
        sharedContext
      )) as NotificationChannelSettingRecord[]
      if (!setting?.enabled || setting.revoked_at) {
        return { status: "rejected" as const, reason: "channel_disabled" }
      }
      await this.updateNotificationChannelSettings(
        {
          id: setting.id,
          configuration: {
            ...setting.configuration,
            seller_recipient: chatId,
          },
        },
        sharedContext
      )
    }

    await this.updateTelegramBindings(
      {
        id: binding.id,
        chat_id: chatId,
        username,
        display_name: displayName,
        state: "active",
        token_used_at: now,
      },
      sharedContext
    )
    return { status: "linked" as const, account_id: binding.account_id }
  }

  @InjectManager()
  async disableTelegramBinding(
    accountId: string,
    @MedusaContext() sharedContext: Context = {}
  ) {
    return this.disableTelegramBinding_(accountId, sharedContext)
  }

  @InjectTransactionManager()
  protected async disableTelegramBinding_(
    accountId: string,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const [binding] = (await this.listTelegramBindings(
      { account_id: accountId },
      {},
      sharedContext
    )) as TelegramBindingRecord[]
    if (!binding) return { connected: false, state: "disabled" as const }

    if (binding.chat_id) {
      await this.updateNotificationMessages(
        {
          selector: {
            channel: "telegram",
            recipient: binding.chat_id,
            state: "retry_pending",
          },
          data: {
            state: "permanently_rejected",
            reason: CUSTOMER_DISABLED_REASON,
          },
        } as never,
        sharedContext
      )
    }
    await this.updateTelegramBindings(
      {
        id: binding.id,
        state: "disabled",
        chat_id: null,
        username: null,
        display_name: null,
        token_hash: null,
        token_expires_at: null,
        token_used_at: null,
      },
      sharedContext
    )
    return { connected: false, state: "disabled" as const }
  }

  @InjectManager()
  async disableTelegramBindingByChatId(
    chatId: string,
    @MedusaContext() sharedContext: Context = {}
  ) {
    return this.disableTelegramBindingByChatId_(chatId, sharedContext)
  }

  @InjectTransactionManager()
  protected async disableTelegramBindingByChatId_(
    chatId: string,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const [binding] = (await this.listTelegramBindings(
      { chat_id: chatId, state: "active" },
      {},
      sharedContext
    )) as TelegramBindingRecord[]

    await this.updateNotificationMessages(
      {
        selector: {
          channel: "telegram",
          recipient: chatId,
          state: "retry_pending",
        },
        data: {
          state: "permanently_rejected",
          reason: CUSTOMER_DISABLED_REASON,
        },
      } as never,
      sharedContext
    )

    if (binding) {
      await this.updateTelegramBindings(
        {
          id: binding.id,
          state: "disabled",
          chat_id: null,
          username: null,
          display_name: null,
          token_hash: null,
          token_expires_at: null,
          token_used_at: null,
        },
        sharedContext
      )
    }

    return { connected: false, state: "disabled" as const }
  }

  async listAdminChannelSettings() {
    const settings = (await this.listNotificationChannelSettings(
      {},
      { order: { version: "DESC" } }
    )) as NotificationChannelSettingRecord[]
    const latest = new Map<
      NotificationChannel,
      NotificationChannelSettingRecord
    >()
    for (const setting of settings) {
      if (!latest.has(setting.channel)) latest.set(setting.channel, setting)
    }
    const channels = [...latest.values()].map(serializeNotificationChannelSetting)
    const timezone = process.env.STORE_TIMEZONE || "Europe/Moscow"
    const calendarDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
    const [counter] = await this.listSmsDailyCounters({
      calendar_date: calendarDate,
      timezone,
    })
    return channels.map((channel) => ({
      ...channel,
      ...(channel.channel === "sms"
        ? { sent_today: counter?.count ?? 0, timezone }
        : {}),
    }))
  }

  @InjectManager()
  async getSellerChannelSettings(
    @MedusaContext() sharedContext: Context = {}
  ) {
    const settings = (await this.listNotificationChannelSettings(
      {},
      { order: { version: "DESC" } },
      sharedContext
    )) as NotificationChannelSettingRecord[]
    const latest = new Map<NotificationChannel, NotificationChannelSettingRecord>()
    for (const setting of settings) {
      if (!latest.has(setting.channel)) latest.set(setting.channel, setting)
    }
    const email = latest.get("email")
    const telegram = latest.get("telegram")
    const emailRecipient = email?.configuration?.seller_recipient
    const telegramRecipient = telegram?.configuration?.seller_recipient
    return {
      email: typeof emailRecipient === "string" ? emailRecipient : null,
      telegram: typeof telegramRecipient === "string" ? telegramRecipient : null,
      telegram_available: Boolean(telegram?.enabled && !telegram.revoked_at),
    }
  }

  @InjectManager()
  async setSellerRecipient(
    channel: "email" | "telegram",
    recipient: string | null,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const [setting] = (await this.listNotificationChannelSettings(
      { channel },
      { order: { version: "DESC" }, take: 1 },
      sharedContext
    )) as NotificationChannelSettingRecord[]
    if (!setting) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Channel ${channel} was not found`
      )
    }
    const configuration = { ...setting.configuration }
    if (recipient) configuration.seller_recipient = recipient
    else delete configuration.seller_recipient
    await this.updateNotificationChannelSettings(
      { id: setting.id, configuration },
      sharedContext
    )
    return this.getSellerChannelSettings(sharedContext)
  }

  @InjectManager()
  async setSmsDailyLimit(
    dailyLimit: number,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const [setting] = (await this.listNotificationChannelSettings(
      { channel: "sms" },
      { order: { version: "DESC" }, take: 1 },
      sharedContext
    )) as NotificationChannelSettingRecord[]
    if (!setting) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Channel sms was not found"
      )
    }
    const updated = (await this.updateNotificationChannelSettings(
      { id: setting.id, daily_limit: dailyLimit },
      sharedContext
    )) as NotificationChannelSettingRecord
    return serializeNotificationChannelSetting(updated)
  }

  async retrieveRuntimeChannelCredentials(versionId: string) {
    const setting = (await this.retrieveNotificationChannelSetting(
      versionId
    )) as NotificationChannelSettingRecord
    return setting.encrypted_credentials
      ? decryptNotificationCredentials(setting.encrypted_credentials)
      : null
  }

  @InjectManager()
  async replaceChannelCredentials(
    input: ConfigureNotificationChannelInput,
    @MedusaContext() sharedContext: Context = {}
  ) {
    return this.replaceChannelCredentials_(input, sharedContext)
  }

  @InjectTransactionManager()
  protected async replaceChannelCredentials_(
    input: ConfigureNotificationChannelInput,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const settings = (await this.listNotificationChannelSettings(
      { channel: input.channel },
      { order: { version: "DESC" } },
      sharedContext
    )) as NotificationChannelSettingRecord[]
    const current = settings[0]
    const nextVersion = (current?.version ?? 0) + 1
    const publicCredentials = input.credentials as {
      from?: string
      bot_username?: string
      sender?: string
    }

    if (current?.enabled) {
      await this.updateNotificationChannelSettings(
        { id: current.id, enabled: false },
        sharedContext
      )
    }

    const setting = (await this.createNotificationChannelSettings(
      {
        channel: input.channel,
        version: nextVersion,
        enabled: current?.enabled ?? false,
        encrypted_credentials: encryptNotificationCredentials(input.credentials),
        configuration: {
          ...current?.configuration,
          ...(input.channel === "email"
            ? { sender: publicCredentials.from }
            : input.channel === "telegram"
              ? { bot_username: publicCredentials.bot_username, webhook: input.webhook }
              : { sender: publicCredentials.sender }),
        },
        daily_limit:
          input.channel === "sms"
            ? input.daily_limit ?? current?.daily_limit ?? 100
            : null,
        verified_at: new Date(),
        revoked_at: null,
      },
      sharedContext
    )) as NotificationChannelSettingRecord

    return serializeNotificationChannelSetting(setting)
  }

  @InjectManager()
  async setChannelEnabled(
    channel: NotificationChannel,
    enabled: boolean,
    @MedusaContext() sharedContext: Context = {}
  ) {
    return this.setChannelEnabled_(channel, enabled, sharedContext)
  }

  @InjectTransactionManager()
  protected async setChannelEnabled_(
    channel: NotificationChannel,
    enabled: boolean,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const [current] = (await this.listNotificationChannelSettings(
      { channel },
      { order: { version: "DESC" }, take: 1 },
      sharedContext
    )) as NotificationChannelSettingRecord[]
    if (!current) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Channel ${channel} was not found`
      )
    }
    if (enabled && (!current.verified_at || current.revoked_at)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Channel ${channel} must have verified credentials before it can be enabled`
      )
    }

    const updated = (await this.updateNotificationChannelSettings(
      { id: current.id, enabled },
      sharedContext
    )) as NotificationChannelSettingRecord
    if (!enabled) {
      await this.rejectRetryPending(channel, sharedContext)
    }
    return serializeNotificationChannelSetting(updated)
  }

  @InjectManager()
  async revokeChannel(
    channel: NotificationChannel,
    @MedusaContext() sharedContext: Context = {}
  ) {
    return this.revokeChannel_(channel, sharedContext)
  }

  @InjectTransactionManager()
  protected async revokeChannel_(
    channel: NotificationChannel,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const [current] = (await this.listNotificationChannelSettings(
      { channel },
      { order: { version: "DESC" }, take: 1 },
      sharedContext
    )) as NotificationChannelSettingRecord[]
    if (!current) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Channel ${channel} was not found`
      )
    }
    const updated = (await this.updateNotificationChannelSettings(
      { id: current.id, enabled: false, revoked_at: new Date() },
      sharedContext
    )) as NotificationChannelSettingRecord
    await this.rejectRetryPending(channel, sharedContext)
    return serializeNotificationChannelSetting(updated)
  }

  @InjectTransactionManager()
  private async rejectRetryPending(
    channel: NotificationChannel,
    @MedusaContext() sharedContext: Context = {}
  ) {
    await this.updateNotificationMessages(
      {
        selector: { channel, state: "retry_pending" },
        data: {
          state: "permanently_rejected",
          reason: CHANNEL_DISABLED_REASON,
        },
      } as never,
      sharedContext
    )
  }

  async createNotificationOnce(input: CreateNotificationInput) {
    const identity = {
      event_key: input.event_key,
      type: input.type,
      recipient: input.recipient,
      channel: input.channel,
    }
    const findExisting = async () => {
      const [notification] = await this.listNotificationMessages(identity)
      return notification ?? null
    }
    const existing = await findExisting()
    if (existing) return { notification: existing, created: false as const }

    try {
      const notification = await this.createNotificationMessages({
        ...input,
        reason: input.reason ?? null,
        template_key: input.template_key ?? null,
        template_revision: input.template_revision ?? null,
        is_test: input.is_test ?? false,
        state: "processing",
      })
      return { notification, created: true as const }
    } catch (error) {
      const concurrent = await findExisting()
      if (concurrent) {
        return { notification: concurrent, created: false as const }
      }
      throw error
    }
  }

  @InjectTransactionManager()
  // eslint-disable-next-line @medusajs/use-inject-manager-on-public-methods
  async transitionNotification(
    id: string,
    expectedState: NotificationState,
    nextState: NotificationState,
    reason?: string | null,
    nextAttemptAt?: Date | null,
    leaseToken?: string | null,
    @MedusaContext() sharedContext: Context = {}
  ) {
    assertNotificationTransition(expectedState, nextState)

    if (leaseToken) {
      const manager = sharedContext.transactionManager as TransactionManager
      const rows = (await manager.getConnection().execute(
        `update "notification_message"
         set "state" = ?, "reason" = ?, "next_attempt_at" = ?,
             "lease_token" = null, "lease_expires_at" = null, "updated_at" = now()
         where "id" = ? and "state" = ? and "lease_token" = ? and "deleted_at" is null
         returning "id"`,
        [nextState, reason ?? null, nextAttemptAt ?? null, id, expectedState, leaseToken]
      )) as unknown[]
      if (rows.length !== 1) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Notification ${id} is not owned by this delivery lease`
        )
      }
      return this.retrieveNotificationMessage(id, {}, sharedContext)
    }

    const updated = await this.updateNotificationMessages({
      selector: { id, state: expectedState },
      data: {
        state: nextState,
        reason: reason ?? null,
        next_attempt_at: nextAttemptAt ?? null,
      },
    } as never)
    const notification = Array.isArray(updated) ? updated[0] : updated

    if (!notification) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Notification ${id} is not in expected state ${expectedState}`
      )
    }

    return notification
  }

  @InjectTransactionManager()
  // A delivery lease and its expiry check must serialize with one another.
  // eslint-disable-next-line @medusajs/use-inject-manager-on-public-methods
  async claimNotificationDeliveryLease(
    id: string,
    _now: Date,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const manager = sharedContext.transactionManager as TransactionManager
    const rows = (await manager.getConnection().execute(
      `update "notification_message"
       set "lease_token" = ?,
           "lease_expires_at" = now() + (? * interval '1 millisecond'),
           "updated_at" = now()
       where "id" = ? and "state" = 'processing' and "deleted_at" is null
         and ("lease_token" is null or "lease_expires_at" <= now())
       returning "lease_token"`,
      [randomUUID(), NOTIFICATION_DELIVERY_LEASE_MS, id]
    )) as { lease_token?: string }[]
    return rows[0]?.lease_token ?? null
  }

  @InjectTransactionManager()
  // eslint-disable-next-line @medusajs/use-inject-manager-on-public-methods
  async renewNotificationDeliveryLease(
    id: string,
    leaseToken: string,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const manager = sharedContext.transactionManager as TransactionManager
    const rows = (await manager.getConnection().execute(
      `update "notification_message"
       set "lease_expires_at" = now() + (? * interval '1 millisecond'), "updated_at" = now()
       where "id" = ? and "state" = 'processing' and "lease_token" = ?
         and "lease_expires_at" > now() and "deleted_at" is null
       returning "id"`,
      [NOTIFICATION_DELIVERY_LEASE_MS, id, leaseToken]
    )) as unknown[]
    return rows.length === 1
  }

  @InjectTransactionManager()
  // The conditional update is the sweep's atomic lease check and terminal claim.
  // eslint-disable-next-line @medusajs/use-inject-manager-on-public-methods
  async exhaustProcessingNotificationIfLeaseExpired(
    id: string,
    _leaseExpiry: Date,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const manager = sharedContext.transactionManager as TransactionManager
    const rows = (await manager.getConnection().execute(
      `update "notification_message" as message
       set "state" = 'retries_exhausted',
           "reason" = 'delivery window exhausted',
           "next_attempt_at" = null,
           "lease_token" = null,
           "lease_expires_at" = null,
           "updated_at" = now()
       where message."id" = ?
         and message."state" = 'processing'
         and message."deleted_at" is null
         and (message."lease_token" is null or message."lease_expires_at" <= now())
       returning message."id"`,
      [id]
    )) as unknown[]
    return rows.length === 1
  }
}

export default NotificationDomainModuleService
