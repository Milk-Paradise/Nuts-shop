import { z } from "zod"

export const RegisterEmailPasswordSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(8, "Пароль должен содержать не менее 8 символов"),
})
