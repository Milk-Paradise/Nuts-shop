import { z } from "@medusajs/framework/zod"

export const GetCatalogCartSchema = z.object({
  cart_id: z.string().trim().min(1),
})

export type GetCatalogCartQuery = z.infer<typeof GetCatalogCartSchema>

// zodValidator (@medusajs/framework) вызывает .strict() на любой ZodObject,
// у которого есть метод strict — а он есть и после .passthrough(). Передать
// произвольные поля можно только явно их перечислив; .passthrough() здесь
// framework всё равно стирает.
export const UpdateCatalogCartSchema = z.object({
  cart_id: z.string().trim().min(1),
  version: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type UpdateCatalogCartBody = z.infer<typeof UpdateCatalogCartSchema>
