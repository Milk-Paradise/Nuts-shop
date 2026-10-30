import type NotificationDomainModuleService from "./service"
import type {
  DeliveryResult,
  NonSmsDeliveryAdapter,
} from "./delivery-executor"
import type {
  NotificationChannelCredentials,
  NotificationChannelSettingRecord,
} from "./channel-settings"
import { TelegramBotClient } from "./telegram-client"

export const CUSTOMER_DISABLED_TELEGRAM_REASON =
  "покупатель отключил канал"

type TelegramDeliveryService = Pick<
  NotificationDomainModuleService,
  | "listNotificationChannelSettings"
  | "retrieveRuntimeChannelCredentials"
  | "disableTelegramBindingByChatId"
>

function messageText(content: Record<string, unknown>) {
  const body = content.body ?? content.text
  return typeof body === "string" ? body : ""
}

function diagnostics(status?: number, errorCode?: number) {
  return {
    ...(status === undefined ? {} : { http_status: status }),
    ...(errorCode === undefined ? {} : { telegram_error_code: errorCode }),
  }
}

const NOT_SENT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
])

function networkErrorCode(error: unknown): string | null {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause]
  for (const candidate of candidates) {
    const code = (candidate as { code?: unknown } | null)?.code
    if (typeof code === "string") return code
  }
  return null
}

export class TelegramDeliveryAdapter implements NonSmsDeliveryAdapter {
  readonly channel = "telegram" as const

  constructor(
    private readonly service: TelegramDeliveryService,
    private readonly client = new TelegramBotClient()
  ) {}

  async deliver(
    input: Parameters<NonSmsDeliveryAdapter["deliver"]>[0]
  ): Promise<DeliveryResult> {
    const [setting] = (await this.service.listNotificationChannelSettings(
      { channel: "telegram" },
      { order: { version: "DESC" }, take: 1 }
    )) as NotificationChannelSettingRecord[]

    if (!setting?.enabled || setting.revoked_at) {
      return {
        classification: "permanent_failure",
        reason: "канал отключён",
        channel_setting_version_id: setting?.id ?? null,
      }
    }

    const credentials = (await this.service.retrieveRuntimeChannelCredentials(
      setting.id
    )) as NotificationChannelCredentials["telegram"] | null
    if (!credentials?.bot_token) {
      return {
        classification: "permanent_failure",
        channel_setting_version_id: setting.id,
        safe_diagnostics: { configuration_error: true },
      }
    }

    try {
      const { status, payload } = await this.client.sendMessage(
        credentials.bot_token,
        input.notification.recipient,
        messageText(input.notification.content)
      )
      const errorCode = payload.error_code
      if (status === 403 || errorCode === 403) {
        await this.service.disableTelegramBindingByChatId(
          input.notification.recipient
        )
        return {
          classification: "permanent_failure",
          reason: CUSTOMER_DISABLED_TELEGRAM_REASON,
          channel_setting_version_id: setting.id,
          safe_diagnostics: diagnostics(status, errorCode),
        }
      }
      if (status >= 200 && status < 300 && payload.ok === true) {
        return {
          classification: "success",
          external_id:
            payload.result?.message_id === undefined
              ? null
              : String(payload.result.message_id),
          channel_setting_version_id: setting.id,
        }
      }
      const failureCode = errorCode ?? status
      return {
        classification:
          failureCode === 429 || failureCode >= 500
            ? "temporary_failure"
            : "permanent_failure",
        channel_setting_version_id: setting.id,
        safe_diagnostics: diagnostics(status, errorCode),
      }
    } catch (error) {
      // Соединение не установлено — сообщение точно не ушло: временный отказ.
      // Обрыв или таймаут после отправки — исход неизвестен.
      const code = networkErrorCode(error)
      return {
        classification:
          code && NOT_SENT_ERROR_CODES.has(code) ? "temporary_failure" : "unknown",
        channel_setting_version_id: setting.id,
        safe_diagnostics: {
          error_name: error instanceof Error ? error.name : "UnknownError",
          ...(code ? { error_code: code } : {}),
        },
      }
    }
  }
}
