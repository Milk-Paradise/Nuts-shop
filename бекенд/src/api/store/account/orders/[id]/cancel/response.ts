import type { AccountOrder } from "../../utils"

export type CatalogOrderCancellationOutcome = "canceled" | "return_requested"

export function catalogOrderCancellationResponse(
  order: AccountOrder,
  outcome: CatalogOrderCancellationOutcome
) {
  return outcome === "canceled"
    ? { order, outcome, message: "Заказ отменён" as const }
    : { order, outcome, message: "Заявка на возврат отправлена" as const }
}
