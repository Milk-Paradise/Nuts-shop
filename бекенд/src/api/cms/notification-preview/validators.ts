import { z } from "@medusajs/framework/zod"

import { NOTIFICATION_EVENTS } from "../../../lib/cms-content"

export const CmsNotificationPreviewSchema = z
  .object({
    event: z.enum(NOTIFICATION_EVENTS),
    channel: z.enum(["email", "telegram", "sms"]),
    subject: z.string().nullable().optional(),
    text: z.string().min(1),
    order_id: z.string().min(1).optional(),
    use_example: z.boolean().optional(),
    send_test: z.boolean().optional(),
    phone: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.order_id) === Boolean(value.use_example)) {
      context.addIssue({
        code: "custom",
        message: "Provide either order_id or use_example",
      })
    }
    if (value.send_test && value.channel === "sms" && !value.phone) {
      context.addIssue({ code: "custom", message: "phone is required for an SMS test" })
    }
    if (value.send_test && value.channel === "sms" && value.phone) {
      const digits = value.phone.replace(/\D/g, "")
      const valid =
        (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) ||
        (digits.length === 10 && digits.startsWith("9"))
      if (!valid) {
        context.addIssue({ code: "custom", message: "phone must be a Russian +7 number" })
      }
    }
  })

export type CmsNotificationPreviewBody = z.infer<
  typeof CmsNotificationPreviewSchema
>
