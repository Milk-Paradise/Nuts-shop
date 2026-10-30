import { z } from "zod"

export const UnsubscribeAbandonedCartSchema = z.object({
  customer_id: z.string().min(1, "customer_id обязателен"),
  token: z.string().min(1, "token обязателен"),
})

export type UnsubscribeAbandonedCartInput = z.infer<typeof UnsubscribeAbandonedCartSchema>
