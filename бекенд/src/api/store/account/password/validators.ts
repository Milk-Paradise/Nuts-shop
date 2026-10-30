import { z } from "@medusajs/framework/zod"

export const ChangeAccountPasswordSchema = z
  .object({
    current_password: z.string().min(1),
    new_password: z
      .string()
      .min(8, "Пароль должен содержать не менее 8 символов"),
  })
  .strict()

export type ChangeAccountPassword = z.infer<typeof ChangeAccountPasswordSchema>
