import { z } from "zod";
export const orderSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Укажите имя, минимум 2 символа")
      .max(100, "Не более 100 символов"),
    phone: z
      .string()
      .trim()
      .max(30)
      .refine((value) => {
        const count = value.replace(/\D/g, "").length;
        return count >= 10 && count <= 15;
      }, "Укажите телефон с кодом страны"),
    email: z.string().trim().email("Проверьте email").max(200),
    delivery: z.enum(["delivery", "pickup"]),
    address: z.string().trim().max(500),
    comment: z.string().trim().max(1000, "Не более 1000 символов").default(""),
    consent: z.literal(true, {
      error: "Подтвердите согласие на обработку данных",
    }),
    items: z
      .array(
        z.object({
          productId: z.string().min(1).max(100),
          variantId: z.string().min(1).max(100),
          quantity: z.number().int().min(1).max(99),
        }),
      )
      .min(1, "Корзина пуста")
      .max(30, "Не более 30 позиций"),
  })
  .superRefine((data, ctx) => {
    if (data.delivery === "delivery" && data.address.length < 5)
      ctx.addIssue({
        code: "custom",
        message: "Укажите адрес доставки",
        path: ["address"],
      });
    const keys = data.items.map((i) => `${i.productId}:${i.variantId}`);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: "custom",
        message: "Повторяющиеся позиции",
        path: ["items"],
      });
  });
export type OrderInput = z.infer<typeof orderSchema>;
