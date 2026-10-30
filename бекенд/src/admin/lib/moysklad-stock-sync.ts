export type MoyskladUnmatchedSource = "moysklad_product" | "medusa_variant"

export type MoyskladUnmatchedReason =
  | "missing_moysklad_code"
  | "ambiguous_moysklad_code"
  | "ambiguous_medusa_sku"
  | "missing_moysklad_match"

const sourceLabels: Record<MoyskladUnmatchedSource, string> = {
  moysklad_product: "Номенклатура МойСклад",
  medusa_variant: "Вариант каталога"
}

const reasonLabels: Record<MoyskladUnmatchedReason, string> = {
  missing_moysklad_code: "Код номенклатуры отсутствует",
  ambiguous_moysklad_code: "Коду соответствуют несколько товаров МойСклад",
  ambiguous_medusa_sku: "SKU соответствует нескольким вариантам каталога",
  missing_moysklad_match: "Нет соответствия в МойСклад"
}

export function formatMoyskladCycleDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("ru-RU") : "Ещё не было"
}

export function getMoyskladUnmatchedSourceLabel(source: MoyskladUnmatchedSource): string {
  return sourceLabels[source]
}

export function getMoyskladUnmatchedReasonLabel(reason: MoyskladUnmatchedReason): string {
  return reasonLabels[reason]
}
