import type { IOrderModuleService, MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import { refundCatalogCustomerOrderWorkflow } from "../../../workflows/refund-catalog-customer-order"
import {
  CATALOG_REFUND_ERROR_METADATA_KEY,
  CATALOG_REFUND_REQUEST_AMOUNT_METADATA_KEY,
  CATALOG_REFUND_REQUEST_ID_METADATA_KEY,
  CATALOG_REFUND_STATUS_METADATA_KEY,
  CATALOG_REFUND_UPDATED_AT_METADATA_KEY,
} from "../../../workflows/steps/execute-catalog-order-refund"

export type CatalogRefundAdminState = {
  status: "refunded" | "partial" | "error" | null
  error: string | null
  updated_at: string | null
}

function metadataText(
  metadata: Record<string, unknown> | null | undefined,
  key: string
) {
  const value = metadata?.[key]

  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function catalogRefundAdminState(
  metadata: Record<string, unknown> | null | undefined
): CatalogRefundAdminState {
  const rawStatus = metadataText(metadata, CATALOG_REFUND_STATUS_METADATA_KEY)

  return {
    status:
      rawStatus === "refunded" ||
      rawStatus === "partial" ||
      rawStatus === "error"
        ? rawStatus
        : null,
    error: metadataText(metadata, CATALOG_REFUND_ERROR_METADATA_KEY),
    updated_at: metadataText(metadata, CATALOG_REFUND_UPDATED_AT_METADATA_KEY),
  }
}

export async function retrieveCatalogRefundAdminState(
  container: MedusaContainer,
  orderId: string
) {
  const orderModule = container.resolve(Modules.ORDER) as IOrderModuleService
  const order = await orderModule.retrieveOrder(orderId, {
    select: ["metadata"],
  })

  return catalogRefundAdminState(order.metadata)
}

type RunRefund = (input: {
  order_id: string
  requested_by?: string
  requested_amount?: number
  refund_request_id?: string
}) => Promise<unknown>

async function prepareRefundRequest(
  container: MedusaContainer,
  input: {
    order_id: string
    requested_amount?: number
    request_id: string
  }
) {
  const orderModule = container.resolve(Modules.ORDER) as IOrderModuleService
  const order = await orderModule.retrieveOrder(input.order_id, {
    select: ["metadata"],
  })
  const metadata = order.metadata ?? {}
  const state = catalogRefundAdminState(metadata)
  const storedAmount = metadata[CATALOG_REFUND_REQUEST_AMOUNT_METADATA_KEY]
  const sameAmount =
    (input.requested_amount === undefined && storedAmount == null) ||
    (input.requested_amount !== undefined &&
      Number(storedAmount) === input.requested_amount)
  const retryState =
    state.status === "error" ||
    metadata[CATALOG_REFUND_STATUS_METADATA_KEY] === "result_unknown"
  const isRetry = retryState && sameAmount
  if (retryState && !sameAmount) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Сумма повторного возврата должна совпадать с исходным запросом"
    )
  }
  const requestId =
    isRetry && typeof metadata[CATALOG_REFUND_REQUEST_ID_METADATA_KEY] === "string"
      ? metadata[CATALOG_REFUND_REQUEST_ID_METADATA_KEY]
      : input.request_id

  await orderModule.updateOrders(input.order_id, {
    metadata: {
      ...metadata,
      [CATALOG_REFUND_REQUEST_ID_METADATA_KEY]: requestId,
      [CATALOG_REFUND_REQUEST_AMOUNT_METADATA_KEY]:
        input.requested_amount ?? null,
    },
  })

  return requestId
}

export async function retryCatalogOrderRefund(
  container: MedusaContainer,
  input: {
    order_id: string
    requested_by?: string
    requested_amount?: number
    confirmed?: boolean
    request_id: string
  },
  runRefund: RunRefund = async (workflowInput) =>
    refundCatalogCustomerOrderWorkflow(container).run({ input: workflowInput })
) {
  const current = await retrieveCatalogRefundAdminState(
    container,
    input.order_id
  )

  if (
    current.status !== null &&
    current.status !== "error" &&
    current.status !== "partial" &&
    current.status !== "refunded"
  ) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Возврат недоступен в текущем состоянии заказа"
    )
  }

  if (input.confirmed !== true) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Для возврата требуется явное подтверждение оператора"
    )
  }

  const refundRequestId = await prepareRefundRequest(container, {
    order_id: input.order_id,
    requested_amount: input.requested_amount,
    request_id: input.request_id,
  })

  await runRefund({
    order_id: input.order_id,
    requested_by: input.requested_by,
    requested_amount: input.requested_amount,
    refund_request_id: refundRequestId,
  })

  return retrieveCatalogRefundAdminState(container, input.order_id)
}
