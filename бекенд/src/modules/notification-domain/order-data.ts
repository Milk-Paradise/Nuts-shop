import type {
  NotificationTemplateContent,
  NotificationVariables,
  RenderedNotificationContent,
} from "./renderer"
import { renderNotification } from "./renderer"

export const ORDER_NOTIFICATION_FIELDS = [
  "id",
  "display_id",
  "customer_id",
  "email",
  "currency_code",
  "total",
  "payment_status",
  "metadata",
  "items.title",
  "items.variant_title",
  "items.variant_sku",
  "items.quantity",
  "items.unit_price",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.phone",
  "shipping_address.city",
  "shipping_address.province",
  "shipping_address.postal_code",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_methods.name",
  "shipping_methods.amount",
  "shipping_methods.data",
  "fulfillments.tracking_numbers",
  "fulfillments.tracking_links.tracking_number",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.captured_at",
] as const

type QueryGraph = {
  graph(input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }): Promise<{ data: unknown[] }>
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is UnknownRecord => !!item) : []
}

function scalar(value: unknown): string | number | boolean | null {
  if (value instanceof Date) return value.toISOString()
  return ["string", "number", "boolean"].includes(typeof value)
    ? (value as string | number | boolean)
    : null
}

function firstText(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null
}

function formatAddress(address: UnknownRecord | null) {
  if (!address) return null
  return [address.postal_code, address.province, address.city, address.address_1, address.address_2]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(", ") || null
}

function pickupPoint(methods: UnknownRecord[], metadata: UnknownRecord | null) {
  const metadataAddress = firstText(
    metadata?.checkout_pickup_point_address,
    metadata?.store_pickup_address
  )
  if (metadataAddress) {
    return {
      id: scalar(metadata?.checkout_pickup_point_id),
      name: scalar(metadata?.checkout_pickup_point_name),
      address: metadataAddress,
    }
  }
  for (const method of methods) {
    const data = record(method.data)
    const point = record(data?.pickup_point) ?? record(data?.store_pickup)
    if (!point) continue
    return {
      id: scalar(point.id),
      name: scalar(point.name),
      address: scalar(point.address),
    }
  }
  return null
}

function trackingNumber(fulfillments: UnknownRecord[]) {
  for (const fulfillment of fulfillments) {
    const direct = Array.isArray(fulfillment.tracking_numbers)
      ? fulfillment.tracking_numbers.find((value) => typeof value === "string")
      : null
    const linked = records(fulfillment.tracking_links).map((link) => link.tracking_number)
      .find((value) => typeof value === "string")
    const found = firstText(direct, linked)
    if (found) return found
  }
  return null
}

export type LoadedOrderNotificationData = {
  order: NotificationVariables
  order_number: string
  customer_name: string | null
  order_total: string | null
  order_status: string | null
  payment_status: string | null
  delivery_address: string | null
  pickup_point_address: string | null
  tracking_number: string | null
}

export function orderNotificationVariables(
  value: unknown,
  shipmentValue?: unknown
): LoadedOrderNotificationData {
  const order = record(value)
  if (!order || typeof order.id !== "string") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Order data is incomplete")
  }

  const items = records(order.items)
  const methods = records(order.shipping_methods)
  const address = record(order.shipping_address)
  const pickup = pickupPoint(methods, record(order.metadata))
  const payments = records(order.payment_collections).flatMap((collection) => records(collection.payments))
  const shipment = record(shipmentValue)
  const itemLines = items.map((item) => {
    const title = firstText(item.title, item.variant_title, item.variant_sku) ?? "—"
    return `${title} × ${Number(item.quantity ?? 0)}`
  })

  const number = scalar(order.display_id) ?? order.id
  const deliveryAddress = pickup?.address ?? formatAddress(address)
  const tracking = firstText(
    shipment?.tracking_number,
    trackingNumber(records(order.fulfillments))
  )
  const paymentStatus = scalar(order.payment_status)
  const customerName = [address?.first_name, address?.last_name]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ") || null

  return {
    order: {
      id: order.id,
      customer_id: scalar(order.customer_id),
      number,
      email: scalar(order.email),
      phone: scalar(address?.phone),
      currency_code: scalar(order.currency_code),
      total: scalar(order.total),
      items: itemLines,
      items_text: itemLines.join("; "),
      delivery_name: scalar(methods[0]?.name),
      delivery_amount: scalar(methods[0]?.amount),
      pickup_point: pickup,
      pickup_address: pickup?.address ?? null,
      delivery_address: deliveryAddress,
      tracking_number: tracking,
      payment_status: paymentStatus,
      payment_provider: scalar(payments[0]?.provider_id),
      payment_captured_at: scalar(payments.find((payment) => payment.captured_at)?.captured_at),
    },
    order_number: String(number),
    customer_name: customerName,
    order_total: scalar(order.total) == null ? null : String(scalar(order.total)),
    order_status: null,
    payment_status: paymentStatus == null ? null : String(paymentStatus),
    delivery_address: deliveryAddress == null ? null : String(deliveryAddress),
    pickup_point_address: pickup?.address == null ? null : String(pickup.address),
    tracking_number: tracking,
  }
}

export async function loadOrderNotificationData(
  query: QueryGraph,
  orderId: string
): Promise<LoadedOrderNotificationData> {
  const [{ data: orders }, { data: shipments }] = await Promise.all([
    query.graph({
      entity: "order",
      fields: [...ORDER_NOTIFICATION_FIELDS],
      filters: { id: orderId },
    }),
    query.graph({
      entity: "shipping_shipment",
      fields: ["id", "tracking_number"],
      filters: { order_id: orderId, status: "created" },
    }),
  ])
  if (!orders[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order '${orderId}' was not found`)
  }
  return orderNotificationVariables(orders[0], shipments[0])
}

/** Loads first and renders second, so a failed core query cannot yield partial content. */
export async function renderOrderNotification(
  query: QueryGraph,
  orderId: string,
  template: NotificationTemplateContent
): Promise<RenderedNotificationContent> {
  const variables = await loadOrderNotificationData(query, orderId)
  return renderNotification(template, variables)
}
import { MedusaError } from "@medusajs/framework/utils"
