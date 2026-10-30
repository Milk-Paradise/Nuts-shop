export type MoyskladUnmatchedSource = "moysklad_product" | "medusa_variant"

export type MoyskladUnmatchedReason =
  | "missing_moysklad_code"
  | "ambiguous_moysklad_code"
  | "ambiguous_medusa_sku"
  | "missing_moysklad_match"

export type MoyskladUnmatchedItem = {
  source: MoyskladUnmatchedSource
  source_id: string
  code: string | null
  sku: string | null
  name: string | null
  reason: MoyskladUnmatchedReason
}
