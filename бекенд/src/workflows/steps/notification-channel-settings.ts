import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  type ConfigureNotificationChannelInput,
  type NotificationChannel,
} from "../../modules/notification-domain/channel-settings"
import { NotificationChannelVerifier } from "../../modules/notification-domain/channel-verification"
import { NOTIFICATION_DOMAIN_MODULE } from "../../modules/notification-domain"

type NotificationChannelSettingsService = {
  replaceChannelCredentials(
    input: ConfigureNotificationChannelInput
  ): Promise<unknown>
  setChannelEnabled(
    channel: NotificationChannel,
    enabled: boolean
  ): Promise<unknown>
  revokeChannel(channel: NotificationChannel): Promise<unknown>
  setSmsDailyLimit(dailyLimit: number): Promise<unknown>
}

type ChannelVerifier = Pick<NotificationChannelVerifier, "verify">

export async function configureNotificationChannel(
  container: Pick<MedusaContainer, "resolve">,
  input: ConfigureNotificationChannelInput,
  verifier: ChannelVerifier = new NotificationChannelVerifier()
) {
  const verification = await verifier.verify(input.channel, input.credentials)
  const service = container.resolve<NotificationChannelSettingsService>(
    NOTIFICATION_DOMAIN_MODULE
  )
  return service.replaceChannelCredentials({ ...input, ...verification })
}

export const configureNotificationChannelStep = createStep(
  "configure-notification-channel",
  async (input: ConfigureNotificationChannelInput, { container }) => {
    return new StepResponse(await configureNotificationChannel(container, input))
  }
)

export type SetNotificationChannelEnabledInput = {
  channel: NotificationChannel
  enabled: boolean
}

export const setNotificationChannelEnabledStep = createStep(
  "set-notification-channel-enabled",
  async (input: SetNotificationChannelEnabledInput, { container }) => {
    const service = container.resolve<NotificationChannelSettingsService>(
      NOTIFICATION_DOMAIN_MODULE
    )
    return new StepResponse(
      await service.setChannelEnabled(input.channel, input.enabled)
    )
  }
)

export type RevokeNotificationChannelInput = {
  channel: NotificationChannel
}

export const revokeNotificationChannelStep = createStep(
  "revoke-notification-channel",
  async (input: RevokeNotificationChannelInput, { container }) => {
    const service = container.resolve<NotificationChannelSettingsService>(
      NOTIFICATION_DOMAIN_MODULE
    )
    return new StepResponse(await service.revokeChannel(input.channel))
  }
)

export type SetSmsDailyLimitInput = { daily_limit: number }

export const setSmsDailyLimitStep = createStep(
  "set-sms-daily-limit",
  async (input: SetSmsDailyLimitInput, { container }) => {
    const service = container.resolve<NotificationChannelSettingsService>(
      NOTIFICATION_DOMAIN_MODULE
    )
    return new StepResponse(await service.setSmsDailyLimit(input.daily_limit))
  }
)
