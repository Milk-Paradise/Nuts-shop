import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  OrderStatus,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { paymentProviderRegistry } from "../../modules/payment-provider-config/registry"
import {
  CDEK_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../modules/shipping-provider-registry/service"
import { storePickupOrderState } from "../../modules/store-pickup/utils"

type RawPayment = {
  id?: string
  provider_id?: string
  amount?: unknown
  currency_code?: string
  captures?: Array<{ id?: string; amount?: unknown }> | null
  refunds?: Array<{ id?: string; amount?: unknown }> | null
}

type RawOrder = {
  id?: string
  status?: string
  email?: string
  customer?: { id?: string } | null
  metadata?: Record<string, unknown> | null
  items?: Array<{ id?: string }> | null
  fulfillments?: Array<{
    id?: string
    provider_id?: string | null
    canceled_at?: string | null
  }> | null
  payment_collections?: Array<{
    id?: string
    payments?: RawPayment[] | null
  }> | null
}

export type PrepareCatalogOrderCancellationInput = {
  order_id: string
  customer_id: string
  customer_email: string
}

export type PreparedCatalogOrderCancellation = {
  order_id: string
  already_canceled: boolean
  is_online: boolean
  has_outstanding_online_refund: boolean
  line_item_ids: string[]
  payment_collection_ids: string[]
  uncaptured_payment_ids: string[]
  uncaptured_payments: Array<{
    payment_id: string
    provider_id: string
    amount: number
    currency_code: string
  }>
  active_cdek_fulfillment_ids: string[]
  requires_return_request: boolean
  previous_delivery_status: "preparing" | "in_transit" | "delivered" | "return_in_progress" | null
}

const onlineProviderIds = new Set(
  paymentProviderRegistry.map((provider) => provider.medusa_id)
)

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function toSafeAmount(value: unknown) {
  const amount = Number(value)

  return Number.isFinite(amount) ? amount : 0
}

export async function prepareCatalogOrderCancellation(
  container: MedusaContainer,
  input: PrepareCatalogOrderCancellationInput
): Promise<PreparedCatalogOrderCancellation> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "status",
      "email",
      "customer.id",
      "metadata",
      "items.id",
      "fulfillments.id",
      "fulfillments.provider_id",
      "fulfillments.canceled_at",
      "payment_collections.id",
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.amount",
      "payment_collections.payments.currency_code",
      "payment_collections.payments.captures.id",
      "payment_collections.payments.captures.amount",
      "payment_collections.payments.refunds.id",
      "payment_collections.payments.refunds.amount",
    ],
    filters: { id: input.order_id },
  })
  const order = data[0] as RawOrder | undefined
  const canAccess =
    order?.customer?.id === input.customer_id ||
    (normalizeEmail(order?.email) !== "" &&
      normalizeEmail(order?.email) === normalizeEmail(input.customer_email))

  if (!order?.id || !canAccess) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order with id: ${input.order_id} was not found`
    )
  }

  const payments = (order.payment_collections ?? []).flatMap(
    (collection) => collection.payments ?? []
  )
  const onlinePayments = payments.filter(
    (payment) =>
      typeof payment.provider_id === "string" &&
      onlineProviderIds.has(payment.provider_id)
  )
  const alreadyCanceled = order.status === OrderStatus.CANCELED
  const pickup = storePickupOrderState(order.metadata)
  const activeFulfillments = (order.fulfillments ?? []).filter(
    (fulfillment) => !fulfillment.canceled_at
  )
  // Only CDEK fulfillment cancellation is handled by this workflow. Other
  // active providers must not be passed through its carrier cancellation path.
  const hasUnsupportedFulfillment = activeFulfillments.some(
    (fulfillment) =>
      fulfillment.provider_id !== CDEK_PROVIDER_KEY
  )
  const activeCdekFulfillments = activeFulfillments.filter(
    (fulfillment) => fulfillment.provider_id === CDEK_PROVIDER_KEY
  )
  const registry = container.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const [cdekShipment] = activeCdekFulfillments.length
    ? await registry.listShippingShipments({
        order_id: input.order_id,
        provider_key: CDEK_PROVIDER_KEY,
        direction: "forward",
      })
    : []
  const requiresReturnRequest = !!cdekShipment && cdekShipment.simplified_status !== "placed"

  if (!alreadyCanceled) {
    if (
      order.status === OrderStatus.COMPLETED ||
      hasUnsupportedFulfillment ||
      !!pickup?.collected_at
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Заказ уже передан в сборку или доставку и не может быть отменён"
      )
    }
  }

  return {
    order_id: order.id,
    already_canceled: alreadyCanceled,
    is_online: onlinePayments.length > 0,
    has_outstanding_online_refund: onlinePayments.some((payment) => {
      const captured = (payment.captures ?? []).reduce(
        (total, capture) => total + toSafeAmount(capture.amount),
        0
      )
      const refunded = (payment.refunds ?? []).reduce(
        (total, refund) => total + toSafeAmount(refund.amount),
        0
      )

      return captured > refunded
    }),
    line_item_ids: (order.items ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && !!id),
    payment_collection_ids: (order.payment_collections ?? [])
      .map((collection) => collection.id)
      .filter((id): id is string => typeof id === "string" && !!id),
    uncaptured_payment_ids: payments
      .filter((payment) => !(payment.captures?.length ?? 0))
      .map((payment) => payment.id)
      .filter((id): id is string => typeof id === "string" && !!id),
    uncaptured_payments: payments
      .filter(
        (payment) =>
          !(payment.captures?.length ?? 0) &&
          typeof payment.id === "string" &&
          !!payment.id &&
          typeof payment.provider_id === "string" &&
          !!payment.provider_id
      )
      .map((payment) => ({
        payment_id: payment.id as string,
        provider_id: payment.provider_id as string,
        amount: toSafeAmount(payment.amount),
        currency_code: payment.currency_code ?? "rub",
      })),
    active_cdek_fulfillment_ids: alreadyCanceled || requiresReturnRequest
      ? []
      : activeCdekFulfillments
          .map((fulfillment) => fulfillment.id)
          .filter((id): id is string => typeof id === "string" && !!id),
    requires_return_request: !alreadyCanceled && requiresReturnRequest,
    previous_delivery_status: requiresReturnRequest
      ? cdekShipment.simplified_status as PreparedCatalogOrderCancellation["previous_delivery_status"]
      : null,
  }
}

export const prepareCatalogOrderCancellationStep = createStep(
  "prepare-catalog-order-cancellation",
  async (input: PrepareCatalogOrderCancellationInput, { container }) =>
    new StepResponse(await prepareCatalogOrderCancellation(container, input))
)
