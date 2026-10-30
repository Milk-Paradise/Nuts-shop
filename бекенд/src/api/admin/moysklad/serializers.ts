type MoyskladConnectionConfig = {
  is_active: boolean
  credentials_status?: "configured" | "needs_reentry"
  credentials_attention_reason?: string | null
  encrypted_credentials?: string
  stock_sync_last_error?: string | null
  stock_sync_last_attempt_at?: Date | string | null
  stock_sync_last_success_at?: Date | string | null
  stock_sync_unmatched?: unknown
}

const unmatchedSources = new Set(["moysklad_product", "medusa_variant"])
const unmatchedReasons = new Set([
  "missing_moysklad_code",
  "ambiguous_moysklad_code",
  "ambiguous_medusa_sku",
  "missing_moysklad_match"
])

export type MoyskladUnmatchedItemResponse = {
  source: "moysklad_product" | "medusa_variant"
  source_id: string
  code: string | null
  sku: string | null
  name: string | null
  reason:
    | "missing_moysklad_code"
    | "ambiguous_moysklad_code"
    | "ambiguous_medusa_sku"
    | "missing_moysklad_match"
}

export type MoyskladConnectionConfigResponse = {
  configured: boolean
  is_active: boolean
  credentials_status: "configured" | "needs_reentry"
  credentials_attention_reason: string | null
  stock_sync_last_error: string | null
  stock_sync_last_attempt_at: string | null
  stock_sync_last_success_at: string | null
  stock_sync_unmatched: MoyskladUnmatchedItemResponse[]
  attention_reason: string | null
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

export function serializeMoyskladUnmatchedItems(value: unknown): MoyskladUnmatchedItemResponse[] {
  const items = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as Record<string, unknown>).items)
      ? ((value as Record<string, unknown>).items as unknown[])
      : null

  if (!items) {
    return []
  }

  return items.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return []
    }

    const candidate = item as Record<string, unknown>
    if (
      typeof candidate.source !== "string" ||
      !unmatchedSources.has(candidate.source) ||
      typeof candidate.source_id !== "string" ||
      typeof candidate.reason !== "string" ||
      !unmatchedReasons.has(candidate.reason)
    ) {
      return []
    }

    return [
      {
        source: candidate.source as MoyskladUnmatchedItemResponse["source"],
        source_id: candidate.source_id,
        code: nullableString(candidate.code),
        sku: nullableString(candidate.sku),
        name: nullableString(candidate.name),
        reason: candidate.reason as MoyskladUnmatchedItemResponse["reason"]
      }
    ]
  })
}

export function serializeMoyskladConnectionConfig(
  config: MoyskladConnectionConfig | null,
  attentionReason: string | null = null
): MoyskladConnectionConfigResponse {
  return {
    configured: !!config,
    is_active: config?.is_active ?? false,
    credentials_status: config?.credentials_status ?? "configured",
    credentials_attention_reason: config?.credentials_attention_reason ?? null,
    stock_sync_last_error: config?.stock_sync_last_error ?? null,
    stock_sync_last_attempt_at: config?.stock_sync_last_attempt_at
      ? new Date(config.stock_sync_last_attempt_at).toISOString()
      : null,
    stock_sync_last_success_at: config?.stock_sync_last_success_at
      ? new Date(config.stock_sync_last_success_at).toISOString()
      : null,
    stock_sync_unmatched: serializeMoyskladUnmatchedItems(config?.stock_sync_unmatched),
    attention_reason: attentionReason
  }
}
