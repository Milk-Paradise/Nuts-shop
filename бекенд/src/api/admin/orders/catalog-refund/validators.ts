import { z } from "@medusajs/framework/zod"

export const AdminCatalogRefundSchema = z.object({
  amount: z
    .preprocess(
      (value) =>
        typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : value,
      z.number().finite().positive().optional()
    )
    .optional(),
  confirm: z.boolean().optional(),
  request_id: z.string().uuid(),
})

export type AdminCatalogRefundInput = z.infer<
  typeof AdminCatalogRefundSchema
>
