import { MedusaError } from "@medusajs/framework/utils"
import {
  isFlatNotificationTemplateVariable,
  NOTIFICATION_TEMPLATE_VARIABLE,
} from "../../lib/notification-template-variables"

export type NotificationTemplateContent = {
  subject?: string | null
  text: string
  html?: string | null
}

export type RenderedNotificationContent = {
  subject: string | null
  text: string
  html: string | null
}

export type NotificationVariables = Record<string, unknown>

type RenderOptions = {
  required?: readonly string[]
}

function printable(value: unknown, name: string, required: ReadonlySet<string>): string {
  if (value === undefined) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Notification variable '${name}' is missing`
    )
  }
  if (
    required.has(name) &&
    (value === null || (typeof value === "string" && !value.trim()))
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Notification required variable '${name}' is empty`
    )
  }
  if (value === null) return ""
  if (["string", "number", "boolean"].includes(typeof value)) return String(value)
  if (Array.isArray(value) && value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
    return value.join(", ")
  }
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `Notification variable '${name}' is not renderable`
  )
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function renderPart(
  source: string,
  variables: NotificationVariables,
  required: ReadonlySet<string>,
  html = false
) {
  return source.replace(NOTIFICATION_TEMPLATE_VARIABLE, (_match, name: string) => {
    if (!isFlatNotificationTemplateVariable(name)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Notification variable '${name}' is not supported`
      )
    }
    const value = printable(variables[name], name, required)
    return html ? escapeHtml(value) : value
  })
}

/** The only template renderer used by creation, preview, and test notifications. */
export function renderNotification(
  template: NotificationTemplateContent,
  variables: NotificationVariables,
  options: RenderOptions = {}
): RenderedNotificationContent {
  const required = new Set(options.required)
  return {
    subject: template.subject == null ? null : renderPart(template.subject, variables, required),
    text: renderPart(template.text, variables, required),
    html: template.html == null ? null : renderPart(template.html, variables, required, true),
  }
}
