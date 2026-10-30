import type NotificationDomainModuleService from "./service"
import type {
  NotificationChannelCredentials,
  NotificationChannelSettingRecord,
} from "./channel-settings"
import type { DeliveryResult, SmsDeliveryAdapter } from "./delivery-executor"
import { SmscClient, type SmscCredentials, type SmscResponse } from "./smsc-client"

export const SMS_MAX_LENGTH = 201

export function normalizeRussianPhone(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, "")
  if (/^\+7\d{10}$/.test(compact)) return compact
  if (/^[78]\d{10}$/.test(compact)) return `+7${compact.slice(1)}`
  if (/^9\d{9}$/.test(compact)) return `+7${compact}`
  return null
}

function messageText(content: Record<string, unknown>) {
  for (const key of ["text", "body", "message"]) {
    if (typeof content[key] === "string") return content[key] as string
  }
  return ""
}

function errorCode(response: SmscResponse) {
  return typeof response.error_code === "number" ? response.error_code : null
}

function sendResult(response: SmscResponse): DeliveryResult {
  const code = errorCode(response)
  if (code === null && (typeof response.id === "string" || typeof response.id === "number")) {
    return { classification: "success", safe_diagnostics: { sms_count: response.cnt } }
  }
  return {
    classification: code === 1 || code === 2 || code === 3 || code === 6 || code === 7
      ? "permanent_failure"
      : "temporary_failure",
    safe_diagnostics: { provider_error_code: code },
  }
}

function statusResult(response: SmscResponse): DeliveryResult {
  const code = errorCode(response)
  if (code !== null) {
    return {
      classification: code === 1 || code === 2 ? "permanent_failure" : "unknown",
      safe_diagnostics: { provider_error_code: code },
    }
  }
  const status = typeof response.status === "number" ? response.status : null
  if (status === -3) return { classification: "temporary_failure", safe_diagnostics: { provider_status: status, not_found: true } }
  if (status === 0 || status === 1 || status === 2 || status === 4) return { classification: "success", safe_diagnostics: { provider_status: status } }
  if (status === -2 || (status !== null && status >= 3)) return { classification: "permanent_failure", safe_diagnostics: { provider_status: status } }
  return {
    classification: "unknown",
    safe_diagnostics: {
      provider_status: status,
      ...(status === null ? { incomplete_response: true } : {}),
    },
  }
}

type Runtime = { versionId: string; credentials: SmscCredentials }

export class SmscDeliveryAdapter implements SmsDeliveryAdapter {
  readonly channel = "sms" as const
  private readonly pinnedRuntime = new Map<string, Runtime>()

  constructor(
    private readonly service: NotificationDomainModuleService,
    private readonly client = new SmscClient()
  ) {}

  async deliver(input: Parameters<SmsDeliveryAdapter["deliver"]>[0]) {
    const phone = normalizeRussianPhone(input.notification.recipient)
    if (!phone) return this.rejected("phone")
    const text = messageText(input.notification.content)
    if ([...text].length > SMS_MAX_LENGTH) return this.rejected("length")

    const runtime = await this.runtime()
    if (!runtime) return this.rejected("channel_credentials")
    this.pinnedRuntime.set(input.external_id, runtime)

    if (input.attempt_number > 1) {
      let reconciled: DeliveryResult
      try {
        reconciled = statusResult(
          await this.client.status(runtime.credentials, {
            id: input.external_id,
            phone,
          })
        )
      } catch (error) {
        return this.unknown(runtime.versionId, error)
      }
      if (!reconciled.safe_diagnostics?.not_found) {
        this.pinnedRuntime.delete(input.external_id)
        return { ...reconciled, channel_setting_version_id: runtime.versionId }
      }
    }

    try {
      const result = sendResult(
        await this.client.send(runtime.credentials, {
          id: input.external_id,
          phone,
          message: text,
        })
      )
      this.pinnedRuntime.delete(input.external_id)
      return { ...result, channel_setting_version_id: runtime.versionId }
    } catch (error) {
      return this.unknown(runtime.versionId, error)
    }
  }

  async reconcileUnknown(input: Parameters<SmsDeliveryAdapter["reconcileUnknown"]>[0]) {
    const phone = normalizeRussianPhone(input.notification.recipient)
    if (!phone) return this.rejected("phone")
    const runtime =
      this.pinnedRuntime.get(input.external_id) ?? (await this.runtime())
    if (!runtime) return this.rejected("channel_credentials")
    try {
      const result = statusResult(
        await this.client.status(runtime.credentials, {
          id: input.external_id,
          phone,
        })
      )
      return { ...result, channel_setting_version_id: runtime.versionId }
    } catch (error) {
      return this.unknown(runtime.versionId, error)
    } finally {
      this.pinnedRuntime.delete(input.external_id)
    }
  }

  private rejected(reason: string): DeliveryResult {
    return { classification: "permanent_failure", safe_diagnostics: { reason } }
  }

  private unknown(versionId: string, error: unknown): DeliveryResult {
    return {
      classification: "unknown",
      channel_setting_version_id: versionId,
      safe_diagnostics: {
        error_name: error instanceof Error ? error.name : "UnknownError",
      },
    }
  }

  private async runtime(): Promise<Runtime | null> {
    const [setting] = (await this.service.listNotificationChannelSettings(
      { channel: "sms", enabled: true, revoked_at: null },
      { order: { version: "DESC" }, take: 1 }
    )) as NotificationChannelSettingRecord[]
    if (!setting) return null
    const credentials = (await this.service.retrieveRuntimeChannelCredentials(
      setting.id
    )) as NotificationChannelCredentials["sms"] | null
    return credentials ? { versionId: setting.id, credentials } : null
  }
}
