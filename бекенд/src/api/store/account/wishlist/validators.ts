import { z } from "zod"

export const AddWishlistItemSchema = z.object({
  product_id: z.string().min(1, "product_id обязателен"),
})
