import { z } from "@medusajs/framework/zod"

const EmailCredentials = z.object({
  from: z.string().trim().email(),
})

const TelegramCredentials = z.object({
  bot_token: z.string().trim().min(1),
  bot_username: z.string().trim().min(1).optional(),
  webhook_secret: z.string().trim().min(1).optional(),
})

const SmsCredentials = z.object({
  login: z.string().trim().min(1),
  password: z.string().min(1),
  sender: z.string().trim().min(1).optional(),
  callback_secret: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
})

export const AdminConfigureNotificationChannelSchema = z.discriminatedUnion(
  "channel",
  [
    z.object({ channel: z.literal("email"), credentials: EmailCredentials }),
    z.object({
      channel: z.literal("telegram"),
      credentials: TelegramCredentials,
    }),
    z.object({
      channel: z.literal("sms"),
      credentials: SmsCredentials,
      daily_limit: z.number().int().min(0).optional(),
    }),
  ]
)

export type AdminConfigureNotificationChannelBody = z.infer<
  typeof AdminConfigureNotificationChannelSchema
>

export const AdminSetNotificationChannelEnabledSchema = z.object({
  enabled: z.boolean(),
})

export type AdminSetNotificationChannelEnabledBody = z.infer<
  typeof AdminSetNotificationChannelEnabledSchema
>

export const AdminSaveSellerEmailSchema = z.object({
  email: z.string().trim().email(),
})

export type AdminSaveSellerEmailBody = z.infer<
  typeof AdminSaveSellerEmailSchema
>

export const AdminSetSmsDailyLimitSchema = z.object({
  daily_limit: z.number().int().min(0),
})

export type AdminSetSmsDailyLimitBody = z.infer<
  typeof AdminSetSmsDailyLimitSchema
>
