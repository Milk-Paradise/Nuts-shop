import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { paymentProviderRegistry } from "../../../../modules/payment-provider-config/registry"
import {
  CDEK_PROVIDER_KEY,
  OZON_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../../../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../../../modules/shipping-provider-registry/service"
import {
  storePickupOrderState,
  type StorePickupOrderState,
} from "../../../../modules/store-pickup/utils"

type QueryGraph = {
  graph(
    input: {
      entity: string
      fields: string[]
      filters?: Record<string, unknown>
    },
    options?: Record<string, unknown>
  ): Promise<{ data: Record<string, any>[] }>
}

type AccountCustomer = {
  id: string
  email: string
}

type RawOrderAddress = {
  first_name?: string | null
  phone?: string | null
  city?: string | null
  address_1?: string | null
  address_2?: string | null
  country_code?: string | null
}

type RawOrderItem = {
  id?: string | null
  title?: string | null
  subtitle?: string | null
  thumbnail?: string | null
  product_id?: string | null
  product_title?: string | null
  variant_id?: string | null
  variant_title?: string | null
  variant_sku?: string | null
  unit_price?: number | string | null
  total?: number | string | null
  subtotal?: number | string | null
  quantity?: number | string | null
  raw_quantity?: number | string | null
  detail?: {
    quantity?: number | string | null
    raw_quantity?: number | string | null
  } | null
}

type RawPayment = {
  amount?: number | string | null
  provider_id?: string | null
  captured_at?: string | Date | null
  refunds?: Array<{
    amount?: number | string | null
  }> | null
}

type RawPaymentCollection = {
  captured_amount?: number | string | null
  refunded_amount?: number | string | null
  payments?: RawPayment[] | null
}

export type RawOrder = {
  id?: string | null
  display_id?: number | string | null
  status?: string | null
  canceled_at?: string | Date | null
  fulfillment_status?: string | null
  payment_status?: string | null
  email?: string | null
  customer_id?: string | null
  customer?: {
    id?: string | null
  } | null
  currency_code?: string | null
  total?: number | string | null
  subtotal?: number | string | null
  item_total?: number | string | null
  shipping_total?: number | string | null
  tax_total?: number | string | null
  created_at?: string | Date | null
  updated_at?: string | Date | null
  metadata?: Record<string, unknown> | null
  shipping_address?: RawOrderAddress | null
  items?: RawOrderItem[] | null
  fulfillments?: Array<{
    id?: string | null
    provider_id?: string | null
    canceled_at?: string | Date | null
  }> | null
  payment_collections?: RawPaymentCollection[] | null
}

export type AccountPaymentStatus = "paid" | "refund_pending" | "refunded"

export type AccountOrderItem = {
  id: string
  title: string
  product_title: string
  variant_title: string | null
  article: string | null
  thumbnail: string | null
  quantity: number
  unit_price: number
  total: number
}

export type AccountOrder = {
  id: string
  display_id: number | null
  status: string
  fulfillment_status: string
  email: string
  currency_code: string
  total: number
  subtotal: number
  item_total: number
  shipping_total: number
  tax_total: number
  item_count: number
  created_at: string | null
  updated_at: string | null
  payment_status: AccountPaymentStatus | null
  can_cancel: boolean
  can_return: boolean
  store_pickup: StorePickupOrderState | null
  return_request: {
    id: string
    status: "pending" | "approved" | "rejected"
    reason: string | null
    return_tracking_number: string | null
    return_delivery_status: "placed" | "preparing" | "in_transit" | "delivered" | "cancelled" | "return_in_progress" | null
  } | null
  contact: {
    name: string | null
    phone: string | null
    email: string
  }
  address: {
    city: string | null
    address_1: string | null
    address_2: string | null
    country_code: string | null
  }
  comment: string | null
  items?: AccountOrderItem[]
}

const accountOrderFields = [
  "id",
  "display_id",
  "status",
  "canceled_at",
  "fulfillment_status",
  "payment_status",
  "email",
  "customer_id",
  "customer.id",
  "currency_code",
  "total",
  "subtotal",
  "item_total",
  "shipping_total",
  "tax_total",
  "created_at",
  "updated_at",
  "metadata",
  "shipping_address.first_name",
  "shipping_address.phone",
  "shipping_address.city",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.country_code",
  "items.id",
  "items.title",
  "items.subtitle",
  "items.thumbnail",
  "items.product_id",
  "items.product_title",
  "items.variant_id",
  "items.variant_title",
  "items.variant_sku",
  "items.unit_price",
  "items.total",
  "items.subtotal",
  "items.quantity",
  "items.raw_quantity",
  "items.detail.quantity",
  "items.detail.raw_quantity",
  "fulfillments.id",
  "fulfillments.provider_id",
  "fulfillments.canceled_at",
  "payment_collections.captured_amount",
  "payment_collections.refunded_amount",
  "payment_collections.payments.amount",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.captured_at",
  "payment_collections.payments.refunds.amount",
]

function query(scope: MedusaRequest["scope"]) {
  return scope.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function integerValue(value: unknown) {
  const parsed = numberValue(value)
  return parsed > 0 ? Math.trunc(parsed) : 1
}

function dateValue(value: unknown) {
  if (value instanceof Date) return value.toISOString()
  return typeof value === "string" && value.trim() ? value : null
}

const onlinePaymentProviderIds = new Set(
  paymentProviderRegistry.map((provider) => provider.medusa_id)
)

function collectionCapturedAmount(collection: RawPaymentCollection) {
  const aggregate = numberValue(collection.captured_amount)

  if (aggregate > 0) return aggregate

  return (collection.payments ?? []).reduce(
    (sum, payment) =>
      sum + (payment.captured_at ? numberValue(payment.amount) : 0),
    0
  )
}

function collectionRefundedAmount(collection: RawPaymentCollection) {
  const aggregate = numberValue(collection.refunded_amount)

  if (aggregate > 0) return aggregate

  return (collection.payments ?? []).reduce(
    (sum, payment) =>
      sum +
      (payment.refunds ?? []).reduce(
        (refundSum, refund) => refundSum + numberValue(refund.amount),
        0
      ),
    0
  )
}

export function accountPaymentStatus(
  order: RawOrder
): AccountPaymentStatus | null {
  const onlineCollections = (order.payment_collections ?? []).filter(
    (collection) =>
      (collection.payments ?? []).some(
        (payment) =>
          typeof payment.provider_id === "string" &&
          onlinePaymentProviderIds.has(payment.provider_id)
      )
  )

  if (!onlineCollections.length) return null

  const capturedAmount = onlineCollections.reduce(
    (sum, collection) => sum + collectionCapturedAmount(collection),
    0
  )
  const refundedAmount = onlineCollections.reduce(
    (sum, collection) => sum + collectionRefundedAmount(collection),
    0
  )

  if (capturedAmount > 0 && refundedAmount >= capturedAmount) {
    return "refunded"
  }

  return order.status === "canceled" ? "refund_pending" : "paid"
}

export function accountOrderCanCancel(order: RawOrder) {
  const pickup = storePickupOrderState(order.metadata)
  const activeFulfillments = (order.fulfillments ?? []).filter(
    (fulfillment) => !fulfillment.canceled_at
  )

  return (
    order.status !== "canceled" &&
    !order.canceled_at &&
    order.status !== "completed" &&
    !pickup?.collected_at &&
    activeFulfillments.every(
      (fulfillment) =>
        fulfillment.provider_id === CDEK_PROVIDER_KEY ||
        fulfillment.provider_id === OZON_PROVIDER_KEY
    )
  )
}

function metadataText(
  metadata: Record<string, unknown> | null | undefined,
  key: string
) {
  return cleanText(metadata?.[key])
}

function orderCustomerId(order: RawOrder) {
  return order.customer_id ?? order.customer?.id ?? null
}

function canAccessOrder(order: RawOrder, customer: AccountCustomer) {
  const byCustomer = orderCustomerId(order) === customer.id
  const byEmail =
    normalizedEmail(order.email) !== "" &&
    normalizedEmail(order.email) === normalizedEmail(customer.email)

  return byCustomer || byEmail
}

export type OrderBucket = "in_progress" | "history"

// Отменённые заказы всегда в истории независимо от статуса доставки;
// доставленные — тоже в истории; всё остальное — в работе.
// Exported for unit-testing the priority rules directly (see __tests__) —
// fulfillment_status/payment_status are Query-computed, not real columns,
// so exercising every combination through a real order is impractical.
export function classifyOrderBucket(order: RawOrder): OrderBucket {
  if (cleanText(order.status) === "canceled") return "history"
  if (order.canceled_at) return "history"
  if (cleanText(order.fulfillment_status) === "canceled") return "history"
  if (cleanText(order.fulfillment_status) === "delivered") return "history"
  if (storePickupOrderState(order.metadata)?.collected_at) return "history"

  return "in_progress"
}

function orderItem(item: RawOrderItem): AccountOrderItem | null {
  if (!item.id) return null

  const quantity = integerValue(
    item.detail?.quantity ?? item.detail?.raw_quantity ?? item.quantity ?? item.raw_quantity
  )
  const unitPrice = numberValue(item.unit_price)
  const total = numberValue(item.total ?? item.subtotal) || unitPrice * quantity
  const productTitle =
    cleanText(item.product_title) ?? cleanText(item.title) ?? "Товар"

  return {
    id: item.id,
    title: cleanText(item.title) ?? productTitle,
    product_title: productTitle,
    variant_title: cleanText(item.variant_title ?? item.subtitle),
    article: cleanText(item.variant_sku),
    thumbnail: cleanText(item.thumbnail),
    quantity,
    unit_price: unitPrice,
    total,
  }
}

function serializeOrder(order: RawOrder, includeItems: boolean): AccountOrder {
  if (!order.id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Order response does not include an id"
    )
  }

  const items = (order.items ?? [])
    .map(orderItem)
    .filter((item): item is AccountOrderItem => !!item)
  const shippingAddress = order.shipping_address ?? null
  const email = normalizedEmail(order.email)
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const storePickup = storePickupOrderState(order.metadata)

  return {
    id: order.id,
    display_id: order.display_id ? Number(order.display_id) : null,
    status: cleanText(order.status) ?? "pending",
    fulfillment_status: cleanText(order.fulfillment_status) ?? "not_fulfilled",
    email,
    currency_code: cleanText(order.currency_code) ?? "rub",
    total: numberValue(order.total),
    subtotal: numberValue(order.subtotal),
    item_total: numberValue(order.item_total),
    shipping_total: numberValue(order.shipping_total),
    tax_total: numberValue(order.tax_total),
    item_count: itemCount,
    created_at: dateValue(order.created_at),
    updated_at: dateValue(order.updated_at),
    payment_status: accountPaymentStatus(order),
    can_cancel: accountOrderCanCancel(order),
    can_return: false,
    store_pickup: storePickup,
    return_request: null,
    contact: {
      name:
        cleanText(shippingAddress?.first_name) ??
        metadataText(order.metadata, "checkout_contact_name"),
      phone:
        cleanText(shippingAddress?.phone) ??
        metadataText(order.metadata, "checkout_contact_phone"),
      email,
    },
    address: {
      city:
        cleanText(shippingAddress?.city) ??
        metadataText(order.metadata, "checkout_address_city"),
      address_1: cleanText(shippingAddress?.address_1),
      address_2: cleanText(shippingAddress?.address_2),
      country_code: cleanText(shippingAddress?.country_code),
    },
    comment: metadataText(order.metadata, "checkout_comment"),
    ...(includeItems ? { items } : {}),
  }
}

async function retrieveOrders(
  scope: MedusaRequest["scope"],
  filters: Record<string, unknown>
) {
  const { data } = await query(scope).graph({
    entity: "order",
    fields: accountOrderFields,
    filters,
  })

  return data as RawOrder[]
}

export async function retrieveAccountCustomer(
  req: AuthenticatedMedusaRequest
): Promise<AccountCustomer> {
  const customerId = req.auth_context.actor_id
  const { data } = await query(req.scope).graph(
    {
      entity: "customer",
      fields: ["id", "email"],
      filters: { id: customerId },
    },
    { throwIfKeyNotFound: true }
  )
  const customer = data[0] as { id?: string; email?: string } | undefined

  if (!customer?.id || !customer.email) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Customer with id: ${customerId} was not found`
    )
  }

  return {
    id: customer.id,
    email: customer.email,
  }
}

// "all" is a first-class filter value, not the absence of a filter. That
// distinction matters: paging must behave the same whichever value is chosen.
export type OrderFilter = OrderBucket | "all"
export type OrderSort = "created_at_desc" | "created_at_asc"

export type ListAccountOrdersOptions = {
  filter?: OrderFilter
  sort?: OrderSort
  limit?: number
  offset?: number
}

export type ListAccountOrdersResult = {
  orders: AccountOrder[]
  count: number
}

export async function listAccountOrders(
  scope: MedusaRequest["scope"],
  customer: AccountCustomer,
  options: ListAccountOrdersOptions = {}
): Promise<ListAccountOrdersResult> {
  const byEmail = await retrieveOrders(scope, {
    email: normalizedEmail(customer.email),
  })
  const byCustomer = await retrieveOrders(scope, {
    customer_id: customer.id,
  })
  const unique = new Map<string, RawOrder>()

  for (const order of [...byEmail, ...byCustomer]) {
    if (order.id && canAccessOrder(order, customer)) {
      unique.set(order.id, order)
    }
  }

  // Order and filter are applied to the whole set, and only then is it cut into
  // pages. Doing it the other way round would hand back short pages, because
  // the bucket of an order is computed, not a column the database can filter on.
  const ascending = options.sort === "created_at_asc"
  const sorted = Array.from(unique.values()).sort((left, right) => {
    const leftTime = Date.parse(String(left.created_at ?? ""))
    const rightTime = Date.parse(String(right.created_at ?? ""))
    const left0 = Number.isFinite(leftTime) ? leftTime : 0
    const right0 = Number.isFinite(rightTime) ? rightTime : 0

    return ascending ? left0 - right0 : right0 - left0
  })

  const filter = options.filter ?? "all"
  const filtered =
    filter === "all"
      ? sorted
      : sorted.filter((order) => classifyOrderBucket(order) === filter)

  const offset = options.offset ?? 0
  const page =
    options.limit !== undefined ? filtered.slice(offset, offset + options.limit) : filtered

  return {
    orders: page.map((order) => serializeOrder(order, false)),
    // Counted after filtering and before paging: this is how many orders the
    // customer's current view has, not how many fit on the page.
    count: filtered.length,
  }
}

export async function retrieveAccountOrder(
  scope: MedusaRequest["scope"],
  customer: AccountCustomer,
  orderId: string
) {
  const [order] = await retrieveOrders(scope, { id: orderId })

  if (!order || !canAccessOrder(order, customer)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order with id: ${orderId} was not found`
    )
  }

  const serialized = serializeOrder(order, true)
  const registry = scope.resolve<ShippingProviderRegistryModuleService>(
    SHIPPING_PROVIDER_REGISTRY_MODULE
  )
  const [shipment] = serialized.store_pickup
    ? []
    : await registry.listShippingShipments({
        order_id: orderId,
        direction: "forward",
        simplified_status: { $ne: "cancelled" },
      }, { order: { created_at: "DESC" }, take: 1 })
  const requests = await registry.listShippingReturnRequests(
    { order_id: orderId },
    { order: { created_at: "DESC" }, take: 1 }
  )
  const request = requests[0]
  serialized.can_cancel = serialized.can_cancel &&
    (!shipment || shipment.simplified_status === "placed")
  serialized.can_return = serialized.status !== "canceled" &&
    (serialized.store_pickup
      ? !!serialized.store_pickup.collected_at
      : !!shipment && shipment.simplified_status !== "placed" &&
        shipment.simplified_status !== "cancelled") &&
    (!request || request.status === "rejected")
  serialized.return_request = request ? {
    id: request.id,
    status: request.status,
    reason: request.reason,
    return_tracking_number: request.return_tracking_number,
    return_delivery_status: request.return_delivery_status,
  } : null
  return serialized
}
