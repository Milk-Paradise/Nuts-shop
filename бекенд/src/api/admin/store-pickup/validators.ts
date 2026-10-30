import { z } from "@medusajs/framework/zod"

export const SaveStorePickupSettingsSchema = z.object({
  address: z.string().max(500),
  hours: z.string().max(500),
  is_enabled: z.boolean(),
}).strict()

export type SaveStorePickupSettingsBody = z.infer<
  typeof SaveStorePickupSettingsSchema
>
