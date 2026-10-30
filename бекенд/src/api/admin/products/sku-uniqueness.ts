import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { NextFunction } from "express"

type VariantSkuEntry = {
  sku: string
  variantId?: string
}

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }): Promise<{ data: { id: string; sku?: string | null }[] }>
}

const DUPLICATE_SKU_MESSAGE = (sku: string) =>
  `Артикул "${sku}" уже используется другим вариантом товара. Укажите уникальный артикул или оставьте поле пустым.`

function requestBody(req: MedusaRequest) {
  return (req as MedusaRequest & { validatedBody?: unknown }).validatedBody ?? req.body
}

function normalizeVariantSku(variant: unknown): VariantSkuEntry | null {
  if (!variant || typeof variant !== "object") {
    return null
  }

  const record = variant as Record<string, unknown>

  if (!("sku" in record)) {
    return null
  }

  if (record.sku == null) {
    return null
  }

  if (typeof record.sku !== "string") {
    return null
  }

  const sku = record.sku.trim()
  record.sku = sku || null

  if (!sku) {
    return null
  }

  return {
    sku,
    variantId: typeof record.id === "string" ? record.id : undefined,
  }
}

function bodyRecord(body: unknown) {
  if (!body || typeof body !== "object") {
    return null
  }

  return body as Record<string, unknown>
}

function collectProductVariantEntries(body: unknown) {
  const record = bodyRecord(body)

  if (!record || !Array.isArray(record.variants)) {
    return []
  }

  return record.variants
    .map(normalizeVariantSku)
    .filter((entry): entry is VariantSkuEntry => !!entry)
}

function collectVariantEntry(body: unknown, variantId?: string) {
  const entry = normalizeVariantSku(body)

  if (!entry) {
    return []
  }

  return [
    {
      ...entry,
      variantId: entry.variantId ?? variantId,
    },
  ]
}

function collectVariantBatchEntries(body: unknown) {
  const record = bodyRecord(body)

  if (!record) {
    return []
  }

  return [
    ...(Array.isArray(record.create)
      ? record.create.map(normalizeVariantSku)
      : []),
    ...(Array.isArray(record.update)
      ? record.update.map(normalizeVariantSku)
      : []),
  ].filter((entry): entry is VariantSkuEntry => !!entry)
}

function duplicateSkuFromRequest(entries: VariantSkuEntry[]) {
  const seen = new Set<string>()

  for (const entry of entries) {
    if (seen.has(entry.sku)) {
      return entry.sku
    }

    seen.add(entry.sku)
  }

  return null
}

async function assertUniqueSkus(
  container: MedusaContainer,
  entries: VariantSkuEntry[]
) {
  const duplicateSku = duplicateSkuFromRequest(entries)

  if (duplicateSku) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      DUPLICATE_SKU_MESSAGE(duplicateSku)
    )
  }

  const skus = Array.from(new Set(entries.map((entry) => entry.sku)))

  if (!skus.length) {
    return
  }

  const ignoredVariantIds = new Set(
    entries
      .map((entry) => entry.variantId)
      .filter((variantId): variantId is string => !!variantId)
  )
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku"],
    filters: { sku: skus },
  })

  const conflictingVariant = variants.find(
    (variant) => variant.sku && !ignoredVariantIds.has(variant.id)
  )

  if (conflictingVariant?.sku) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      DUPLICATE_SKU_MESSAGE(conflictingVariant.sku)
    )
  }
}

async function validateEntries(
  req: MedusaRequest,
  entries: VariantSkuEntry[],
  next: NextFunction
) {
  try {
    await assertUniqueSkus(req.scope, entries)
    return next()
  } catch (error) {
    return next(error)
  }
}

export async function validateProductSkuUniqueness(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: NextFunction
) {
  return validateEntries(req, collectProductVariantEntries(requestBody(req)), next)
}

export async function validateVariantSkuUniqueness(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: NextFunction
) {
  return validateEntries(
    req,
    collectVariantEntry(requestBody(req), req.params.variant_id),
    next
  )
}

export async function validateVariantBatchSkuUniqueness(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: NextFunction
) {
  return validateEntries(req, collectVariantBatchEntries(requestBody(req)), next)
}
