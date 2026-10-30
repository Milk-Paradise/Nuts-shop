import {
  formatMoyskladCycleDate,
  getMoyskladUnmatchedReasonLabel,
  getMoyskladUnmatchedSourceLabel
} from "../moysklad-stock-sync"

describe("MoySklad stock-sync admin formatting", () => {
  it("uses explicit labels for each diagnostic source and reason", () => {
    expect(getMoyskladUnmatchedSourceLabel("moysklad_product")).toBe("Номенклатура МойСклад")
    expect(getMoyskladUnmatchedSourceLabel("medusa_variant")).toBe("Вариант каталога")
    expect(getMoyskladUnmatchedReasonLabel("missing_moysklad_code")).toBe("Код номенклатуры отсутствует")
    expect(getMoyskladUnmatchedReasonLabel("ambiguous_moysklad_code")).toContain("несколько товаров")
    expect(getMoyskladUnmatchedReasonLabel("ambiguous_medusa_sku")).toContain("нескольким вариантам")
    expect(getMoyskladUnmatchedReasonLabel("missing_moysklad_match")).toBe("Нет соответствия в МойСклад")
  })

  it("distinguishes an absent cycle timestamp", () => {
    expect(formatMoyskladCycleDate(null)).toBe("Ещё не было")
  })
})
