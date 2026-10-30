import { z } from "zod"

export const SaveMoyskladConnectionSchema = z.object({
  credentials: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("token"),
      token: z.string().trim().min(1),
    }),
    z.object({
      type: z.literal("basic"),
      login: z.string().trim().min(1),
      password: z.string().min(1),
    }),
  ]),
})

export type SaveMoyskladConnectionBody = z.infer<
  typeof SaveMoyskladConnectionSchema
>

export const SetMoyskladConnectionActivitySchema = z.object({
  is_active: z.boolean(),
})

export type SetMoyskladConnectionActivityBody = z.infer<
  typeof SetMoyskladConnectionActivitySchema
>

export const GetMoyskladOrderSyncsSchema = z.object({
  status: z.enum(["pending", "syncing", "synced", "error"]).optional(),
})

export type GetMoyskladOrderSyncsQuery = z.infer<
  typeof GetMoyskladOrderSyncsSchema
>
