import { z } from "zod"

export const SetShippingProviderVisibilitySchema = z.object({
  provider_key: z.string().min(1),
  is_visible: z.boolean(),
})

export type SetShippingProviderVisibilitySchema = z.infer<
  typeof SetShippingProviderVisibilitySchema
>

export const SaveCdekProviderConfigurationSchema = z.object({
  client_id: z.string().trim().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  configuration: z.object({
    sender: z.object({
      city: z.string().trim().min(1),
      street: z.string().trim().min(1),
      postal_code: z.string().trim().min(1),
      contact_name: z.string().trim().min(1),
      phone: z.string().trim().min(1),
    }),
    contract_type: z.enum(["online_store", "delivery"]),
    tariff_codes: z.array(z.number().int().positive()).min(1),
  }),
})

export type SaveCdekProviderConfigurationBody = z.infer<
  typeof SaveCdekProviderConfigurationSchema
>

export const SaveOzonProviderConfigurationSchema = z.object({
  client_id: z.string().trim().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  configuration: z.object({
    sender: z.object({
      city: z.string().trim().min(1),
      postal_code: z.string().trim().min(1).optional(),
    }).optional(),
    max_weight_grams: z.number().int().positive().optional(),
    pickup_point_cache_ttl_seconds: z.number().int().positive().optional(),
  }),
})

export type SaveOzonProviderConfigurationBody = z.infer<
  typeof SaveOzonProviderConfigurationSchema
>

export const ListCdekTariffsSchema = z.object({
  client_id: z.string().trim().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  contract_type: z.enum(["online_store", "delivery"]),
  sender: z.object({
    city: z.string().trim().min(1),
    postal_code: z.string().trim().min(1),
  }),
})

export type ListCdekTariffsBody = z.infer<typeof ListCdekTariffsSchema>

export const SaveShippingStorePackageSchema = z.object({
  weight_grams: z.number().int().positive(),
  length_mm: z.number().int().positive(),
  width_mm: z.number().int().positive(),
  height_mm: z.number().int().positive(),
})

export type SaveShippingStorePackageBody = z.infer<
  typeof SaveShippingStorePackageSchema
>
