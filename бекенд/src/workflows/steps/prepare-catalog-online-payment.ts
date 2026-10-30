import type {
  IPaymentModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PAYMENT_PROVIDER_CONFIG_MODULE } from "../../modules/payment-provider-config"
import {
  getRegisteredPaymentProvider,
  paymentProviderRegistry,
} from "../../modules/payment-provider-config/registry"
import PaymentProviderConfigModuleService from "../../modules/payment-provider-config/service"
import { PAYMENT_OPERATION_MODULE } from "../../modules/payment-operation"
import PaymentOperationModuleService from "../../modules/payment-operation/service"

const SYSTEM_PAYMENT_PROVIDER_ID = "pp_system_default"

type OrderForOnlinePayment = {
  id?: string
  email?: string | null
  total?: unknown
  currency_code?: string | null
  metadata?: Record<string, unknown> | null
  customer_id?: string | null
  customer?: { id?: string | null } | null
  region_id?: string | null
  sales_channel_id?: string | null
  shipping_address?: {
    first_name?: string | null
    phone?: string | null
  } | null
  status?: string | null
  payment_collections?: Array<{
    captured_amount?: number | string | null
    refunded_amount?: number | string | null
    payments?: Array<{
      amount?: number | string | null
      provider_id?: string | null
      captured_at?: string | Date | null
      refunds?: Array<{ amount?: number | string | null }> | null
    }> | null
  }> | null
}

type ResolvedOrderForOnlinePayment = OrderForOnlinePayment & {
  id: string
  total: number
  currency_code: string
}

type ExistingOnlinePayment = {
  payment_collection_id: string
  payment_session_id: string
  redirect_url: string
}

export type PreparedCatalogOnlinePayment = {
  order_id: string
  status: "already_paid" | "active" | "created" | "pending_reconciliation"
  cart_id: string
  payment_operation_id: string | null
  payment_collection_id: string
  medusa_provider_id: string
  contacts: {
    email: string | null
    shipping_address: {
      first_name: string | null
      phone: string | null
    }
  }
  existing_payment: ExistingOnlinePayment | null
  e2e_fail_initiation: boolean
}

const reusablePaymentStatuses = new Set([
  "authorized",
  "captured",
  "pending",
  "pending_authorization",
  "requires_more",
])

const activePaymentOperationStates = new Set(["processing", "retry_pending"])
const onlinePaymentProviderIds = new Set(
  paymentProviderRegistry.map((provider) => provider.medusa_id)
)

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

function finiteNumberValue(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (typeof value !== "number" &&
      typeof value !== "string" &&
      typeof value !== "object")
  ) {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function orderHasCapturedOnlinePayment(order: OrderForOnlinePayment) {
  const onlineCollections = (order.payment_collections ?? []).filter(
    (collection) =>
      (collection.payments ?? []).some(
        (payment) =>
          typeof payment.provider_id === "string" &&
          onlinePaymentProviderIds.has(payment.provider_id)
      )
  )

  if (!onlineCollections.length) return false

  const capturedAmount = onlineCollections.reduce((sum, collection) => {
    const aggregate = numberValue(collection.captured_amount)
    if (aggregate > 0) return sum + aggregate

    return (
      sum +
      (collection.payments ?? []).reduce(
        (paymentSum, payment) =>
          paymentSum +
          (payment.captured_at ? numberValue(payment.amount) : 0),
        0
      )
    )
  }, 0)
  const refundedAmount = onlineCollections.reduce((sum, collection) => {
    const aggregate = numberValue(collection.refunded_amount)
    if (aggregate > 0) return sum + aggregate

    return (
      sum +
      (collection.payments ?? []).reduce(
        (paymentSum, payment) =>
          paymentSum +
          (payment.refunds ?? []).reduce(
            (refundSum, refund) => refundSum + numberValue(refund.amount),
            0
          ),
        0
      )
    )
  }, 0)

  return (
    capturedAmount > 0 && refundedAmount < capturedAmount &&
    order.status !== "canceled"
  )
}

async function retrieveOrder(
  container: MedusaContainer,
  orderId: string
): Promise<ResolvedOrderForOnlinePayment> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "email",
      "total",
      "currency_code",
      "metadata",
      "customer_id",
      "customer.id",
      "region_id",
      "sales_channel_id",
      "shipping_address.first_name",
      "shipping_address.phone",
      "status",
      "payment_collections.captured_amount",
      "payment_collections.refunded_amount",
      "payment_collections.payments.amount",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.refunds.amount",
    ],
    filters: { id: orderId },
  })
  const order = data[0] as OrderForOnlinePayment | undefined

  if (!order?.id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ не найден")
  }

  const total = finiteNumberValue(order.total)
  if (
    total === null ||
    typeof order.currency_code !== "string" ||
    !order.currency_code
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "В заказе недостаточно данных для оплаты"
    )
  }

  return { ...order, total } as ResolvedOrderForOnlinePayment
}

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

async function assertOrderAccess(
  container: MedusaContainer,
  order: ResolvedOrderForOnlinePayment,
  customerId: string | null | undefined
) {
  if (!customerId) {
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "customer",
    fields: ["id", "email"],
    filters: { id: customerId },
  })
  const customer = data[0] as
    | { id?: string; email?: string | null }
    | undefined
  const orderCustomerId = order.customer_id ?? order.customer?.id ?? null
  const byCustomer = orderCustomerId === customer?.id
  const byEmail =
    normalizedEmail(order.email) !== "" &&
    normalizedEmail(order.email) === normalizedEmail(customer?.email)

  if (!customer?.id || (!byCustomer && !byEmail)) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ не найден")
  }
}

async function retrieveOrderPaymentCollectionId(
  container: MedusaContainer,
  orderId: string
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_payment_collection",
    fields: ["order_id", "payment_collection_id"],
    filters: { order_id: orderId },
  })
  const paymentCollectionId = data[0]?.payment_collection_id

  if (typeof paymentCollectionId !== "string" || !paymentCollectionId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Платёжная коллекция заказа не найдена"
    )
  }

  return paymentCollectionId
}

async function retrieveOrderCartId(
  container: MedusaContainer,
  orderId: string
): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_cart",
    fields: ["order_id", "cart_id"],
    filters: { order_id: orderId },
  })
  const cartId = data[0]?.cart_id

  if (typeof cartId !== "string" || !cartId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Исходная корзина заказа не найдена"
    )
  }

  return cartId
}

async function retrievePaymentStore(
  container: MedusaContainer,
  salesChannelId: string | null | undefined
) {
  if (!salesChannelId) {
    return null
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
    filters: { default_sales_channel_id: salesChannelId },
  })

  return data[0]?.id ? { id: data[0].id as string } : null
}

type ReusablePaymentSession = {
  id: string
  provider_id: string
  status: string
  amount: number | string
  currency_code: string
  created_at: string | Date
  data?: Record<string, unknown> | null
}

async function retrieveReusablePaymentSessions(
  container: MedusaContainer,
  paymentCollectionId: string,
  providerId: string
) {
  const paymentService = container.resolve(
    Modules.PAYMENT
  ) as IPaymentModuleService
  const sessions = await paymentService.listPaymentSessions({
    payment_collection_id: paymentCollectionId,
    provider_id: providerId,
  })
  return (sessions as ReusablePaymentSession[])
    .filter(
      (candidate) =>
        candidate.provider_id !== SYSTEM_PAYMENT_PROVIDER_ID &&
        reusablePaymentStatuses.has(candidate.status)
    )
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    )
}

function existingPayment(
  paymentCollectionId: string,
  session: ReusablePaymentSession
) {
  const confirmation = session?.data?.confirmation as
    | { confirmation_url?: unknown }
    | undefined
  const redirectUrl = confirmation?.confirmation_url

  if (typeof redirectUrl !== "string" || !redirectUrl) {
    return null
  }

  return {
    payment_collection_id: paymentCollectionId,
    payment_session_id: session.id,
    redirect_url: redirectUrl,
  } satisfies ExistingOnlinePayment
}

function sessionOperationId(session: ReusablePaymentSession) {
  const operationId = session.data?.payment_operation_id
  return typeof operationId === "string" && operationId ? operationId : null
}

async function assertProviderAvailable(
  container: MedusaContainer,
  input: {
    providerId: string
    salesChannelId: string | null | undefined
    regionId: string | null | undefined
  }
) {
  const configService = container.resolve(
    PAYMENT_PROVIDER_CONFIG_MODULE
  ) as PaymentProviderConfigModuleService
  const store = await retrievePaymentStore(container, input.salesChannelId)
  const [runtimeConfig, isAvailable] = await Promise.all([
    configService.retrieveRuntimePaymentProviderConfig(input.providerId),
    store && input.regionId
      ? configService.isPaymentProviderAvailable(input.providerId, {
          store_id: store.id,
          region_id: input.regionId,
        })
      : false,
  ])

  if (!runtimeConfig?.is_enabled || !isAvailable) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Способ оплаты сейчас недоступен"
    )
  }
}

export async function prepareCatalogOnlinePayment(
  container: MedusaContainer,
  input: {
    order_id: string
    provider_id: string
    customer_id?: string | null
  }
): Promise<PreparedCatalogOnlinePayment> {
  const provider = getRegisteredPaymentProvider(input.provider_id)

  if (!provider) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Способ оплаты не найден"
    )
  }

  const order = await retrieveOrder(container, input.order_id)
  await assertOrderAccess(container, order, input.customer_id)

  const paymentCollectionId = await retrieveOrderPaymentCollectionId(
    container,
    order.id
  )
  const cartId = await retrieveOrderCartId(container, order.id)
  const contacts = {
    email: order.email ?? null,
    shipping_address: {
      first_name: order.shipping_address?.first_name ?? null,
      phone: order.shipping_address?.phone ?? null,
    },
  }
  const e2eFailInitiation =
    process.env.E2E_RUN === "true" &&
    order.metadata?.e2e_payment_fail_initiation === true

  if (orderHasCapturedOnlinePayment(order)) {
    return {
      status: "already_paid",
      order_id: order.id,
      cart_id: cartId,
      payment_operation_id: null,
      payment_collection_id: paymentCollectionId,
      medusa_provider_id: provider.medusa_id,
      contacts,
      existing_payment: null,
      e2e_fail_initiation: e2eFailInitiation,
    }
  }
  const sessions = await retrieveReusablePaymentSessions(
    container,
    paymentCollectionId,
    provider.medusa_id
  )

  const operations = container.resolve<PaymentOperationModuleService>(
    PAYMENT_OPERATION_MODULE
  )
  const paymentOperations = await operations.listPaymentOperations({
    type: "payment",
    order_id: order.id,
    provider_id: provider.id,
  })
  // TODO(AIL-555): reconcile the previous result before allowing another payment.
  const unresolved = paymentOperations.find((operation) => operation.state === "result_unknown")
  if (unresolved) {
    return {
      status: "pending_reconciliation",
      order_id: order.id,
      cart_id: cartId,
      payment_operation_id: unresolved.id,
      payment_collection_id: paymentCollectionId,
      medusa_provider_id: provider.medusa_id,
      contacts,
      existing_payment: null,
      e2e_fail_initiation: e2eFailInitiation,
    }
  }
  const activeOperationIds = new Set(
    paymentOperations
      .filter((operation) => activePaymentOperationStates.has(operation.state))
      .map((operation) => operation.id)
  )
  const activeSession = sessions.find(
    (session) =>
      activeOperationIds.has(sessionOperationId(session) ?? "") &&
      existingPayment(paymentCollectionId, session)
  )

  if (activeSession) {
    return {
      status: "active",
      order_id: order.id,
      cart_id: cartId,
      payment_operation_id: sessionOperationId(activeSession)!,
      payment_collection_id: paymentCollectionId,
      medusa_provider_id: provider.medusa_id,
      contacts,
      existing_payment: existingPayment(paymentCollectionId, activeSession),
      e2e_fail_initiation: e2eFailInitiation,
    }
  }

  if (activeOperationIds.size > 0) {
    return {
      status: "pending_reconciliation",
      order_id: order.id,
      cart_id: cartId,
      payment_operation_id: activeOperationIds.values().next().value!,
      payment_collection_id: paymentCollectionId,
      medusa_provider_id: provider.medusa_id,
      contacts,
      existing_payment: null,
      e2e_fail_initiation: e2eFailInitiation,
    }
  }

  const legacySession = sessions.find(
    (session) => !sessionOperationId(session) && existingPayment(paymentCollectionId, session)
  )
  if (legacySession) {
    await assertProviderAvailable(container, {
      providerId: input.provider_id,
      salesChannelId: order.sales_channel_id,
      regionId: order.region_id,
    })
    const claimed = await operations.claimPaymentOperation({
      type: "payment",
      order_id: null,
      cart_id: cartId,
      provider_id: legacySession.provider_id,
      amount: String(legacySession.amount),
      currency_code: legacySession.currency_code,
      provider_operation_id:
        typeof legacySession.data?.id === "string" ? legacySession.data.id : null,
      idempotency_key: `payment:${legacySession.id}`,
      action: "initiate",
    })

    const needsReconciliation = claimed.operation.state === "result_unknown"
    return {
      status: needsReconciliation ? "pending_reconciliation" : "active",
      order_id: order.id,
      cart_id: cartId,
      payment_operation_id: claimed.operation.id,
      payment_collection_id: paymentCollectionId,
      medusa_provider_id: provider.medusa_id,
      contacts,
      existing_payment: needsReconciliation
        ? null
        : existingPayment(paymentCollectionId, legacySession),
      e2e_fail_initiation: e2eFailInitiation,
    }
  }

  await assertProviderAvailable(container, {
    providerId: input.provider_id,
    salesChannelId: order.sales_channel_id,
    regionId: order.region_id,
  })
  const claimed = await operations.claimPaymentOperation({
    type: "payment",
    order_id: order.id,
    cart_id: cartId,
    provider_id: provider.id,
    amount: order.total,
    currency_code: order.currency_code,
    idempotency_key: `payment:initiate:${order.id}:${provider.id}:${paymentOperations.length}`,
    action: "initiate",
  })

  return {
    status: claimed.operation.state === "result_unknown" ? "pending_reconciliation" : "created",
    order_id: order.id,
    cart_id: cartId,
    payment_operation_id: claimed.operation.id,
    payment_collection_id: paymentCollectionId,
    medusa_provider_id: provider.medusa_id,
    contacts,
    existing_payment: null,
    e2e_fail_initiation: e2eFailInitiation,
  }
}

export const prepareCatalogOnlinePaymentStep = createStep(
  "prepare-catalog-online-payment",
  async (
    input: {
      order_id: string
      provider_id: string
      customer_id?: string | null
    },
    { container }
  ) => {
    return new StepResponse(await prepareCatalogOnlinePayment(container, input))
  }
)
