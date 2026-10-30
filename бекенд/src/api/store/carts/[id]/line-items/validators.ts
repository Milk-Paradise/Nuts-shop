import { z } from "zod"

export const AddLineItemQuerySchema = z.object({}).strict()

export const AddLineItemSchema = z.object({
  variant_id: z.string().min(1, "Variant ID is required"),
  quantity: z.coerce
    .number()
    .int()
    .positive("Quantity must be a positive integer"),
})

export type AddLineItemBody = z.infer<typeof AddLineItemSchema>
export type AddLineItemQuery = z.infer<typeof AddLineItemQuerySchema>
