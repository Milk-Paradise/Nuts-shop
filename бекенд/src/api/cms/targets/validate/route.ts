import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { timingSafeEqual } from "node:crypto"
import { z } from "zod"

import { resolveValidCommerceTargets } from "../../../../lib/cms-commerce-targets"

// Shape mirrors `Target` in lib/cms-commerce-targets: the CMS sends objects,
// not bare ids, so the schema has to match or every valid publish gets a 400.
export const CmsTargetsValidateSchema = z.object({
  targets: z
    .array(
      z.object({
        type: z.enum(["product", "category", "collection", "external_url"]),
        medusaId: z.string().nullish(),
      })
    )
    .default([]),
})

export type CmsTargetsValidateBody = z.infer<typeof CmsTargetsValidateSchema>

function matchesSecret(provided: string | string[] | undefined, expected: string) {
  const value = Array.isArray(provided) ? provided[0] : provided
  if (typeof value !== "string") return false

  const providedBuffer = Buffer.from(value)
  const expectedBuffer = Buffer.from(expected)
  // timingSafeEqual throws on differing lengths, so the length check has to
  // come first — otherwise a wrong-length secret answers 500 instead of 401.
  if (providedBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(providedBuffer, expectedBuffer)
}

export async function POST(
  req: MedusaRequest<CmsTargetsValidateBody>,
  res: MedusaResponse
) {
  const expected = process.env.STRAPI_WEBHOOK_SECRET
  if (!expected || !matchesSecret(req.headers["x-cms-internal-secret"], expected)) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Invalid CMS credentials")
  }
  const valid = await resolveValidCommerceTargets(req.scope, req.validatedBody.targets)
  return res.status(200).json({ valid: [...valid] })
}
