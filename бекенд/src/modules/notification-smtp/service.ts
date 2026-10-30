import type { Logger } from "@medusajs/framework/types"
import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type {
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import nodemailer, { type Transporter } from "nodemailer"

import type {
  DeliveryResult,
  NonSmsDeliveryAdapter,
} from "../notification-domain/delivery-executor"
import type { NotificationChannelSettingRecord } from "../notification-domain/channel-settings"

type InjectedDependencies = {
  logger: Logger
}

export type SmtpNotificationOptions = {
  // Optional, not just at the type level: medusa-config.ts passes these
  // straight from SMTP_* env vars, which are genuinely unset in test env and
  // on a fresh self-hosted deploy before configuration.
  host?: string
  port?: number
  user?: string
  password?: string
  from?: string
  secure?: boolean
}

type EmailProvider = Pick<SmtpNotificationService, "send">

type EmailDeliveryAdapterDependencies = {
  provider: EmailProvider
  listChannelSettings(): Promise<NotificationChannelSettingRecord[]>
  retrieveRuntimeChannelCredentials(
    versionId: string
  ): Promise<Record<string, unknown> | null>
  readCompanyName(): Promise<string | null>
  defaultFrom?: string
  classifyErrors: boolean
}

type SmtpError = {
  code?: unknown
  command?: unknown
  responseCode?: unknown
  smtpCode?: unknown
  smtpCommand?: unknown
  smtpResponseCode?: unknown
}

const TEMPORARY_SMTP_CODES = new Set([
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ESOCKET",
  "ETIMEDOUT",
  "EAI_AGAIN",
])

function smtpDiagnostics(error: unknown) {
  const smtpError =
    error && typeof error === "object" ? (error as SmtpError) : undefined
  const code = smtpError?.smtpCode ?? smtpError?.code
  const command = smtpError?.smtpCommand ?? smtpError?.command
  const responseCode = smtpError?.smtpResponseCode ?? smtpError?.responseCode
  return {
    error_name: error instanceof Error ? error.name : "UnknownError",
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof command === "string" ? { command } : {}),
    ...(typeof responseCode === "number" ? { response_code: responseCode } : {}),
  }
}

export function classifySmtpError(error: unknown): DeliveryResult {
  const smtpError =
    error && typeof error === "object" ? (error as SmtpError) : undefined
  const responseCode = smtpError?.smtpResponseCode ?? smtpError?.responseCode
  const command = smtpError?.smtpCommand ?? smtpError?.command
  const code = smtpError?.smtpCode ?? smtpError?.code
  const classification =
    command === "RCPT TO" &&
    typeof responseCode === "number" &&
    responseCode >= 500 &&
    responseCode < 600
      ? "permanent_failure"
      : (typeof responseCode === "number" && responseCode >= 400 && responseCode < 500) ||
          (typeof code === "string" && TEMPORARY_SMTP_CODES.has(code))
        ? "temporary_failure"
        : "unknown"

  return { classification, safe_diagnostics: smtpDiagnostics(error) }
}

function senderAddress(companyName: string | null, address: string) {
  if (!companyName) return address
  const safeName = companyName.replace(/[\r\n]+/g, " ").replace(/(["\\])/g, "\\$1")
  return `"${safeName}" <${address}>`
}

export function createEmailDeliveryAdapter(
  dependencies: EmailDeliveryAdapterDependencies
): NonSmsDeliveryAdapter {
  return {
    channel: "email",
    async deliver({ notification }) {
      const settings = await dependencies.listChannelSettings()
      // Почта работает всегда: без сохранённой настройки канала письмо уходит
      // с отправителем из окружения (как до перехода на адаптер).
      const current = settings.find((setting) => setting.channel === "email")

      let credentials: Record<string, unknown> | null
      let companyName: string | null
      try {
        const runtime = await Promise.all([
          current
            ? dependencies.retrieveRuntimeChannelCredentials(current.id)
            : Promise.resolve(null),
          dependencies.readCompanyName(),
        ])
        credentials = runtime[0]
        companyName = runtime[1]
      } catch (error) {
        return {
          classification: "temporary_failure",
          channel_setting_version_id: current?.id ?? null,
          safe_diagnostics: smtpDiagnostics(error),
        }
      }
      const configuredFrom = credentials?.from
      const from =
        typeof configuredFrom === "string" && configuredFrom
          ? configuredFrom
          : dependencies.defaultFrom
      if (!from) {
        return {
          classification: "permanent_failure",
          channel_setting_version_id: current?.id ?? null,
          safe_diagnostics: { code: "email_sender_not_configured" },
        }
      }

      try {
        const result = await dependencies.provider.send({
          to: notification.recipient,
          from: senderAddress(companyName, from),
          channel: "email",
          template: notification.type,
          content: {
            subject:
              typeof notification.content.subject === "string"
                ? notification.content.subject
                : undefined,
            text:
              typeof notification.content.text === "string"
                ? notification.content.text
                : undefined,
            html:
              typeof notification.content.html === "string"
                ? notification.content.html
                : undefined,
          },
        })
        return {
          classification: "success",
          external_id: result.id,
          channel_setting_version_id: current?.id ?? null,
        }
      } catch (error) {
        const result = dependencies.classifyErrors
          ? classifySmtpError(error)
          : {
              classification: "temporary_failure" as const,
              safe_diagnostics: smtpDiagnostics(error),
            }
        return { ...result, channel_setting_version_id: current?.id ?? null }
      }
    },
  }
}

class SmtpNotificationService extends AbstractNotificationProviderService {
  static identifier = "smtp"

  protected logger_: Logger
  protected options_: SmtpNotificationOptions
  protected transporter_: Transporter

  // Deliberately doesn't throw when host/from are unset — this module loads
  // unconditionally (including in tests, and on a fresh self-hosted deploy
  // before SMTP_* is configured, see CLAUDE.md self-configuring principle);
  // an unusable transporter just fails at send() time. The provider reports
  // that failure to Medusa so the notification history records it truthfully.
  constructor({ logger }: InjectedDependencies, options: SmtpNotificationOptions) {
    super()

    this.logger_ = logger
    this.options_ = options
    this.transporter_ = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? options.port === 465,
      auth: options.user
        ? { user: options.user, pass: options.password }
        : undefined,
    })
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    if (!notification) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No notification information provided"
      )
    }

    try {
      const info = await this.transporter_.sendMail({
        to: notification.to,
        from: notification.from ?? this.options_.from,
        subject: notification.content?.subject,
        text: notification.content?.text,
        html: notification.content?.html,
        attachments: notification.attachments ?? undefined,
      })

      return { id: info.messageId }
    } catch (error) {
      // Medusa only records a notification as failed when the provider throws.
      // Keep the public error deliberately generic so transport details and
      // credentials can never leak into notification history.
      const providerError = new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "SMTP notification delivery failed"
      )
      const smtpError =
        error && typeof error === "object" ? (error as SmtpError) : undefined
      Object.assign(providerError, {
        ...(typeof smtpError?.code === "string"
          ? { smtpCode: smtpError.code }
          : {}),
        ...(typeof smtpError?.command === "string"
          ? { smtpCommand: smtpError.command }
          : {}),
        ...(typeof smtpError?.responseCode === "number"
          ? { smtpResponseCode: smtpError.responseCode }
          : {}),
      })
      throw providerError
    }
  }
}

export default SmtpNotificationService
