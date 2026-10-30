import { createHash, timingSafeEqual } from "node:crypto"

import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { NOTIFICATION_DOMAIN_MODULE } from "../../modules/notification-domain"
import type NotificationDomainModuleService from "../../modules/notification-domain/service"
import type {
  NotificationChannelCredentials,
  NotificationChannelSettingRecord,
} from "../../modules/notification-domain/channel-settings"
import { normalizeRussianPhone } from "../../modules/notification-domain/smsc-adapter"

export type ProcessSmscCallbackInput = {
  id: string
  phone: string
  status: number
  sha1: string
  time?: string
  err?: number
}

type Attempt = {
  id: string
  notification_id: string
  channel_setting_version_id?: string | null
  safe_diagnostics?: Record<string, unknown> | null
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left.toLowerCase())
  const rightBuffer = Buffer.from(right.toLowerCase())
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export async function processSmscCallback(
  container: Pick<MedusaContainer, "resolve">,
  input: ProcessSmscCallbackInput
) {
  const service = container.resolve<NotificationDomainModuleService>(
    NOTIFICATION_DOMAIN_MODULE
  )
  const [knownAttempt] = (await service.listNotificationAttempts(
    { external_id: input.id },
    { order: { attempt_number: "DESC" }, take: 1 }
  )) as Attempt[]
  const [latestSetting] = knownAttempt?.channel_setting_version_id
    ? []
    : ((await service.listNotificationChannelSettings(
        { channel: "sms" },
        { order: { version: "DESC" }, take: 1 }
      )) as NotificationChannelSettingRecord[])
  const versionId =
    knownAttempt?.channel_setting_version_id ?? latestSetting?.id ?? null
  const credentials = versionId
    ? ((await service.retrieveRuntimeChannelCredentials(
        versionId
      )) as NotificationChannelCredentials["sms"])
    : null
  if (!credentials?.callback_secret) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "SMSC callback secret is not configured"
    )
  }
  const expected = createHash("sha1")
    .update(`${input.id}:${input.phone}:${input.status}:${credentials.callback_secret}`)
    .digest("hex")
  if (!safeEqual(input.sha1, expected)) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Invalid SMSC callback signature")
  }

  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  return locking.execute(`smsc-callback:${input.id}:${input.status}`, async () => {
    const [attempt] = (await service.listNotificationAttempts(
      { external_id: input.id },
      { order: { attempt_number: "DESC" }, take: 1 }
    )) as Attempt[]
    if (!attempt) return { status: "ignored" as const, reason: "unknown_message" }

    const notification = await service.retrieveNotificationMessage(
      attempt.notification_id
    )
    if (normalizeRussianPhone(notification.recipient) !== normalizeRussianPhone(input.phone)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "SMSC callback phone mismatch")
    }
    const previous = attempt.safe_diagnostics ?? {}
    if (previous.callback_status === input.status) {
      return { status: "duplicate" as const }
    }
    await service.updateNotificationAttempts({
      id: attempt.id,
      safe_diagnostics: {
        ...previous,
        callback_status: input.status,
        callback_error: input.err ?? null,
        callback_time: input.time ?? null,
      },
    })
    return { status: "processed" as const }
  }, { timeout: 15 })
}

export const processSmscCallbackStep = createStep(
  "process-smsc-callback",
  async (input: ProcessSmscCallbackInput, { container }) =>
    new StepResponse(await processSmscCallback(container, input))
)
