import { z } from "@medusajs/framework/zod"

const numberParameter = (fallback: number, maximum: number) =>
  z.preprocess(
    (value) => (typeof value === "string" ? Number(value) : value),
    z.number().int().min(0).max(maximum).default(fallback)
  )

const booleanParameter = z.preprocess(
  (value) => value === true || value === "true",
  z.boolean().default(false)
)

export const GetNotificationsSchema = z.object({
  q: z.string().trim().max(200).optional(),
  channel: z.enum(["email", "telegram", "sms", "none"]).optional(),
  state: z
    .enum([
      "processing",
      "completed",
      "retry_pending",
      "retries_exhausted",
      "permanently_rejected",
      "outcome_unknown",
    ])
    .optional(),
  type: z.string().trim().max(120).optional(),
  show_tests: booleanParameter,
  order_id: z.string().trim().max(120).optional(),
  limit: numberParameter(20, 100),
  offset: numberParameter(0, 10_000_000),
})

export type GetNotificationsQuery = z.infer<typeof GetNotificationsSchema>
