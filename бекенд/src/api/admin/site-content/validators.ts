import { z } from "zod"

import { SITE_TAB_KEYS } from "../../../modules/site-content/models/site-tab"
import { SITE_LINK_KINDS } from "../../../modules/site-content/models/site-link"

export const AdminSaveSiteTabSchema = z.object({
  key: z.enum([...SITE_TAB_KEYS]),
  content: z.string().nullable(),
})
export type AdminSaveSiteTabSchema = z.infer<typeof AdminSaveSiteTabSchema>

export const AdminSaveSiteLinkSchema = z.object({
  id: z.string().optional(),
  kind: z.enum([...SITE_LINK_KINDS]),
  label: z.string().nullable().optional(),
  url: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), {
      message: "URL must start with http:// or https://",
    }),
})
export type AdminSaveSiteLinkSchema = z.infer<typeof AdminSaveSiteLinkSchema>
