export const NOTIFICATION_TEMPLATE_VARIABLE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g

export function notificationTemplateVariables(value: string) {
  return new Set(
    Array.from(value.matchAll(NOTIFICATION_TEMPLATE_VARIABLE), (match) => match[1])
  )
}

export function isFlatNotificationTemplateVariable(name: string) {
  return !name.includes(".")
}
