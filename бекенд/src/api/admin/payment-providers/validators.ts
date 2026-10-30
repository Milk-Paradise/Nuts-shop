import { z } from "zod"

export const AdminSavePaymentProviderConfiguration = z.object({
  shop_id: z.string().optional(),
  secret_key: z.string().nullable().optional(),
  mode: z.enum(["test", "live"]).optional(),
})

export const AdminUpdatePaymentProviderStatus = z.object({
  is_enabled: z.boolean(),
})
