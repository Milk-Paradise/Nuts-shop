import { z } from "@medusajs/framework/zod"

const integer = z.preprocess(
  (value) => (typeof value === "string" ? Number(value) : value),
  z.number().int()
)

export const SmscCallbackSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  phone: z.union([z.string(), z.number()]).transform(String),
  status: integer,
  sha1: z.string().regex(/^[a-fA-F0-9]{40}$/),
  time: z.string().optional(),
  err: integer.optional(),
})

export type SmscCallbackBody = z.infer<typeof SmscCallbackSchema>
