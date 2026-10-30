import type {
  CampaignBudgetUsageContext,
  CreateOrderDTO,
  MedusaContainer,
  UsageComputedActions,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  isDefined,
  isPresent,
  MathBN,
  MedusaError,
  OrderStatus,
  PriceListType,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { paymentProviderRegistry } from "../../modules/payment-provider-config/registry"
import { CART_VERSIONING_MODULE } from "../../modules/cart"
import type CartVersioningService from "../../modules/cart/service"

type GraphRecord = Record<string, any>

export type ExpectedCatalogReservation = {
  cart_line_id: string
  inventory_item_id: string
  quantity: number
}

export type PreparedCatalogPaidOrder = {
  cart_id: string
  cart_version: number | null
  order_id: string | null
  payment_collection_id: string | null
  payment_session_id: string | null
  order_input: CreateOrderDTO | null
  expected_reservations: ExpectedCatalogReservation[]
  promotion_ids: string[]
  promotion_usage: {
    computedActions: UsageComputedActions[]
    registrationContext: CampaignBudgetUsageContext
  }
}

const paidOrderCartFields = [
  "id",
  "version",
  "completed_at",
  "email",
  "currency_code",
  "locale",
  "total",
  "sales_channel_id",
  "metadata",
  "region.id",
  "customer.id",
  "shipping_address.*",
  "billing_address.*",
  "items.*",
  "items.tax_lines.*",
  "items.adjustments.*",
  "items.variant.*",
  "items.variant.product.*",
  "items.variant.product.type.*",
  "items.variant.product.collection.*",
  "items.variant.product.shipping_profile.id",
  "items.variant.inventory_items.inventory_item_id",
  "items.variant.inventory_items.required_quantity",
  "items.variant.inventory_items.inventory.requires_shipping",
  "shipping_methods.*",
  "shipping_methods.tax_lines.*",
  "shipping_methods.adjustments.*",
  "promotions.id",
  "promotions.code",
  "credit_lines.*",
  "payment_collection.id",
  "payment_collection.amount",
  "payment_collection.currency_code",
  "payment_collection.payment_sessions.*",
] as const

function withoutAddressId(address: GraphRecord | null | undefined) {
  if (!address) {
    return undefined
  }

  const result = { ...address }
  delete result.id
  delete result.created_at
  delete result.updated_at
  delete result.deleted_at
  return result
}

function taxLines(lines: GraphRecord[] | null | undefined) {
  return (lines ?? []).map((line) => ({
    description: line.description,
    tax_rate_id: line.tax_rate_id,
    code: line.code,
    rate: line.rate,
    provider_id: line.provider_id,
  }))
}

function adjustments(lines: GraphRecord[] | null | undefined) {
  return (lines ?? []).map((line) => ({
    code: line.code,
    amount: line.amount,
    description: line.description,
    promotion_id: line.promotion_id,
    provider_id: line.provider_id,
    is_tax_inclusive: line.is_tax_inclusive,
  }))
}

function orderLineItem(cartId: string, item: GraphRecord) {
  const variant = item.variant ?? {}
  const product = variant.product ?? {}
  let compareAtUnitPrice = item.compare_at_unit_price
  const isSalePrice =
    variant.calculated_price?.calculated_price?.price_list_type ===
    PriceListType.SALE

  if (
    !isPresent(compareAtUnitPrice) &&
    isSalePrice &&
    !MathBN.eq(
      variant.calculated_price?.original_amount,
      variant.calculated_price?.calculated_amount
    )
  ) {
    compareAtUnitPrice = variant.calculated_price.original_amount
  }

  const hasShippingProfile = isDefined(product.shipping_profile?.id)
  const someInventoryRequiresShipping = !!variant.inventory_items?.some(
    (inventoryItem: GraphRecord) =>
      !!inventoryItem.inventory?.requires_shipping
  )
  const requiresShipping = isDefined(item.requires_shipping)
    ? item.requires_shipping
    : hasShippingProfile || someInventoryRequiresShipping

  return {
    quantity: item.quantity,
    title: item.title ?? product.title,
    subtitle: item.subtitle ?? variant.title,
    thumbnail: item.thumbnail ?? variant.thumbnail ?? product.thumbnail,
    product_id: item.product_id ?? product.id,
    product_title: item.product_title ?? product.title,
    product_description: item.product_description ?? product.description,
    product_subtitle: item.product_subtitle ?? product.subtitle,
    product_type: item.product_type ?? product.type?.value ?? null,
    product_type_id: item.product_type_id ?? product.type?.id ?? null,
    product_collection:
      item.product_collection ?? product.collection?.title ?? null,
    product_handle: item.product_handle ?? product.handle,
    variant_id: item.variant_id ?? variant.id,
    variant_sku: item.variant_sku ?? variant.sku,
    variant_barcode: item.variant_barcode ?? variant.barcode,
    variant_title: item.variant_title ?? variant.title,
    variant_option_values: item.variant_option_values,
    is_discountable: item.is_discountable ?? product.discountable,
    is_giftcard: product.is_giftcard ?? false,
    requires_shipping: requiresShipping,
    unit_price: item.unit_price,
    compare_at_unit_price: compareAtUnitPrice,
    is_tax_inclusive: !!item.is_tax_inclusive,
    tax_lines: taxLines(item.tax_lines),
    adjustments: adjustments(item.adjustments),
    cart_id: cartId,
    metadata: {
      ...(item.metadata ?? {}),
      catalog_cart_line_id: item.id,
    },
  }
}

function expectedReservations(items: GraphRecord[]) {
  return items.flatMap((item) => {
    if (!item.variant?.manage_inventory) {
      return []
    }

    return (item.variant.inventory_items ?? []).map(
      (inventoryItem: GraphRecord) => ({
        cart_line_id: item.id as string,
        inventory_item_id: inventoryItem.inventory_item_id as string,
        quantity:
          Number(item.quantity) * Number(inventoryItem.required_quantity ?? 1),
      })
    )
  })
}

function latestOnlineSession(cart: GraphRecord, requestedSessionId?: string) {
  const registeredProviderIds = new Set(
    paymentProviderRegistry.map((provider) => provider.medusa_id)
  )
  const sessions = (cart.payment_collection?.payment_sessions ?? []) as GraphRecord[]
  const candidates = sessions.filter((session) => {
    if (!registeredProviderIds.has(session.provider_id)) {
      return false
    }

    if (requestedSessionId) {
      return session.id === requestedSessionId
    }

    return true
  })

  return candidates.sort(
    (left, right) =>
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  )[0]
}

export async function prepareCatalogPaidOrder(
  container: MedusaContainer,
  input: { cart_id: string; payment_session_id?: string }
): Promise<PreparedCatalogPaidOrder> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: orderCarts }, { data: carts }] = await Promise.all([
    query.graph({
      entity: "order_cart",
      fields: ["order_id", "cart_id"],
      filters: { cart_id: input.cart_id },
    }),
    query.graph({
      entity: "cart",
      fields: [...paidOrderCartFields],
      filters: { id: input.cart_id },
    }),
  ])
  const existingOrderId = orderCarts[0]?.order_id
  const cart = carts[0] as GraphRecord | undefined

  if (typeof existingOrderId === "string" && existingOrderId) {
    if (!cart?.payment_collection?.id) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Платёжная коллекция заказа не найдена"
      )
    }

    const session = latestOnlineSession(cart, input.payment_session_id)

    if (!session?.id) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Платёжная сессия заказа не найдена"
      )
    }

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "total", "currency_code"],
      filters: { id: existingOrderId },
    })
    const order = orders[0]
    if (
      !order || order.total == null || !order.currency_code ||
      !MathBN.eq(order.total, session.amount) ||
      order.currency_code !== session.currency_code
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Сумма заказа не совпадает с зафиксированной суммой оплаты"
      )
    }

    return {
      cart_id: input.cart_id,
      cart_version: null,
      order_id: existingOrderId,
      payment_collection_id: cart.payment_collection.id,
      payment_session_id: session.id,
      order_input: null,
      expected_reservations: [],
      promotion_ids: [],
      promotion_usage: {
        computedActions: [],
        registrationContext: { customer_id: null, customer_email: null },
      },
    }
  }

  if (!cart || cart.completed_at) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Корзина недоступна для завершения оплаты"
    )
  }

  if (!cart.items?.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Корзина пуста")
  }

  const cartVersion = await container
    .resolve<CartVersioningService>(CART_VERSIONING_MODULE)
    .getVersion(cart.id)

  if (cartVersion === null) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Версия корзины не найдена"
    )
  }

  const session = latestOnlineSession(cart, input.payment_session_id)

  if (!session?.id || !cart.payment_collection?.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Платёжная сессия корзины не найдена"
    )
  }

  if (
    !MathBN.eq(cart.total, session.amount) ||
    cart.currency_code !== session.currency_code
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Сумма корзины не совпадает с зафиксированной суммой оплаты"
    )
  }

  const items = cart.items as GraphRecord[]
  const shippingMethods = (cart.shipping_methods ?? []).map(
    (method: GraphRecord) => ({
      name: method.name,
      description: method.description,
      amount: method.raw_amount ?? method.amount,
      is_tax_inclusive: method.is_tax_inclusive,
      shipping_option_id: method.shipping_option_id,
      data: method.data,
      metadata: method.metadata,
      tax_lines: taxLines(method.tax_lines),
      adjustments: adjustments(method.adjustments),
    })
  )
  const allAdjustments = [
    ...items.flatMap((item) => item.adjustments ?? []),
    ...(cart.shipping_methods ?? []).flatMap(
      (method: GraphRecord) => method.adjustments ?? []
    ),
  ] as GraphRecord[]

  return {
    cart_id: cart.id,
    cart_version: cartVersion,
    order_id: null,
    payment_collection_id: cart.payment_collection.id,
    payment_session_id: session.id,
    order_input: {
      region_id: cart.region?.id,
      customer_id: cart.customer?.id,
      sales_channel_id: cart.sales_channel_id,
      status: OrderStatus.PENDING,
      email: cart.email,
      currency_code: cart.currency_code,
      locale: cart.locale,
      shipping_address: withoutAddressId(cart.shipping_address),
      billing_address: withoutAddressId(cart.billing_address),
      no_notification: false,
      items: items.map((item) => orderLineItem(cart.id, item)),
      shipping_methods: shippingMethods,
      metadata: cart.metadata,
      promo_codes: allAdjustments
        .map((adjustment) => adjustment.code)
        .filter((code): code is string => typeof code === "string" && !!code),
      credit_lines: (cart.credit_lines ?? []).map((line: GraphRecord) => ({
        amount: line.amount,
        raw_amount: line.raw_amount,
        reference: line.reference,
        reference_id: line.reference_id,
        metadata: line.metadata,
      })),
    },
    expected_reservations: expectedReservations(items),
    promotion_ids: (cart.promotions ?? [])
      .map((promotion: GraphRecord) => promotion.id)
      .filter((id: unknown): id is string => typeof id === "string" && !!id),
    promotion_usage: {
      computedActions: allAdjustments
        .filter(
          (adjustment) =>
            typeof adjustment.code === "string" && !!adjustment.code
        )
        .map((adjustment) => ({
          amount: adjustment.amount,
          code: adjustment.code,
        })),
      registrationContext: {
        customer_id: cart.customer?.id ?? null,
        customer_email: cart.email ?? null,
      },
    },
  }
}

export const prepareCatalogPaidOrderStep = createStep(
  "prepare-catalog-paid-order",
  async (
    input: { cart_id: string; payment_session_id?: string },
    { container }
  ) => {
    return new StepResponse(await prepareCatalogPaidOrder(container, input))
  }
)
