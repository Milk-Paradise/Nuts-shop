import { z } from "zod"

export const ResolveShippingReturnRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
})

export type ResolveShippingReturnRequestSchema = z.infer<
  typeof ResolveShippingReturnRequestSchema
>
