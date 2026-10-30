import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { maskNotificationSecrets } from "../../../lib/mask-notification-secrets"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function maskData(value: unknown): unknown {
  if (typeof value === "string") return maskNotificationSecrets(value)
  if (Array.isArray(value)) return value.map(maskData)
  if (!isRecord(value)) return value

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key, key === "token" ? "•••" : maskData(entry),
  ]))
}

function maskNotification(value: unknown): unknown {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, "data")) return value
  return { ...value, data: maskData(value.data) }
}

/** Sanitize only the response; never mutate records shared with delivery. */
export function maskAdminNotificationResponse(
  _req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const json = res.json
  res.json = function (body: unknown) {
    if (isRecord(body)) {
      body = {
        ...body,
        ...(Array.isArray(body.notifications)
          ? { notifications: body.notifications.map(maskNotification) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "notification")
          ? { notification: maskNotification(body.notification) }
          : {}),
      }
    }
    return json.call(this, body)
  }
  next()
}
