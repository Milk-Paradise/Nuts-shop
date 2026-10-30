import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  MoyskladApiError,
  MoyskladClient,
  isMoyskladCredentialsFailure,
  type MoyskladOrderPosition,
} from "../../modules/moysklad-integration/client"
import { MOYSKLAD_INTEGRATION_MODULE } from "../../modules/moysklad-integration"
import type MoyskladIntegrationService from "../../modules/moysklad-integration/service"
import { MoyskladCredentialsReentryError } from "../../modules/moysklad-integration/credentials"
import {
  classifyMoyskladOrderSyncError,
  describeMoyskladOrderSyncError,
} from "../../modules/moysklad-integration/order-sync-error"

export type CreateMoyskladCustomerOrderInput = {
  orderId: string
}

type OrderLineItem = {
  variant_sku: string | null
  title: string
  quantity: number
  unit_price: number
}

type OrderForSync = {
  id: string
  email: string | null
  items: OrderLineItem[]
  shipping_address: {
    first_name: string | null
    last_name: string | null
    phone: string | null
  } | null
}

async function loadOrder(
  container: Pick<MedusaContainer, "resolve">,
  orderId: string
): Promise<OrderForSync> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "email",
      "items.variant_sku",
      "items.title",
      "items.quantity",
      // `items.quantity` is a flattened getter over OrderItem/OrderLineItem
      // and is only populated when the linked detail quantity is loaded.
      "items.detail.quantity",
      "items.unit_price",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "shipping_address.phone",
    ],
    filters: { id: orderId },
  })

  const order = data[0]

  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order ${orderId} was not found.`
    )
  }

  return order as unknown as OrderForSync
}

export async function createMoyskladCustomerOrder(
  container: Pick<MedusaContainer, "resolve">,
  input: CreateMoyskladCustomerOrderInput,
  client: MoyskladClient = new MoyskladClient()
) {
  const moyskladService = container.resolve<MoyskladIntegrationService>(
    MOYSKLAD_INTEGRATION_MODULE
  )

  const existingSync = await moyskladService.getOrderSyncStatus(input.orderId)

  if (existingSync?.status === "synced") {
    return existingSync
  }

  // A prior attempt may have created the MoySklad order but failed to persist
  // that fact (e.g. a DB error right after `createCustomerOrder` succeeded).
  // Re-creating here would produce a second document, so a retry that already
  // has a linked id only needs to confirm the "synced" status, never re-create.
  if (existingSync?.moysklad_order_id) {
    return moyskladService.recordOrderSyncAttempt({
      orderId: input.orderId,
      status: "synced",
      moyskladOrderId: existingSync.moysklad_order_id,
    })
  }

  // Tracks the id once MoySklad confirms creation, so that if persisting the
  // "synced" status below still fails, the error branch records the same id
  // instead of losing it — the branch above then reconciles the next retry
  // without calling `createCustomerOrder` again.
  let createdMoyskladOrderId: string | undefined

  try {
    const connectionConfig = await moyskladService.getConnectionConfig()

    if (connectionConfig?.credentials_status === "needs_reentry") {
      throw new MoyskladCredentialsReentryError(
        connectionConfig.credentials_attention_reason ??
          "МойСклад требует повторного ввода реквизитов."
      )
    }

    if (!connectionConfig?.encrypted_credentials) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "MoySklad connection is not configured."
      )
    }

    const encryptedCredentials = connectionConfig.encrypted_credentials
    const order = await loadOrder(container, input.orderId)
    validateOrderItemQuantities(order)

    const organization = await client.findDefaultOrganization(
      encryptedCredentials
    )
    const positions = await resolvePositions(client, encryptedCredentials, order)
    const agent = await resolveCounterparty(client, encryptedCredentials, order)

    const moyskladOrder = await client.createCustomerOrder(
      encryptedCredentials,
      {
        organizationHref: organization.meta.href,
        agentHref: agent.meta.href,
        description: `Заказ Medusa ${order.id}`,
        positions,
      }
    )

    if (typeof moyskladOrder.id !== "string" || !moyskladOrder.id.trim()) {
      throw new MoyskladApiError(
        "МойСклад не вернул идентификатор созданного заказа."
      )
    }

    createdMoyskladOrderId = moyskladOrder.id

    return await moyskladService.recordOrderSyncAttempt({
      orderId: input.orderId,
      status: "synced",
      moyskladOrderId: moyskladOrder.id,
    })
  } catch (error) {
    if (isMoyskladCredentialsFailure(error)) {
      await moyskladService.markCredentialsReentryRequired(
        error instanceof Error
          ? error.message
          : "МойСклад требует повторного ввода реквизитов."
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    const classification = classifyMoyskladOrderSyncError(error)
    const recordedMessage = describeMoyskladOrderSyncError(
      classification,
      message
    )
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    logger.error(
      `MoySklad order sync failed for order ${input.orderId}. ${recordedMessage}`
    )

    await moyskladService.recordOrderSyncAttempt({
      orderId: input.orderId,
      status: "error",
      ...(createdMoyskladOrderId
        ? { moyskladOrderId: createdMoyskladOrderId }
        : {}),
      lastError: message,
      retryable: classification === "temporary",
    })

    throw error
  }
}

function validateOrderItemQuantities(order: OrderForSync) {
  for (const item of order.items) {
    if (
      typeof item.quantity !== "number" ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Заказ ${order.id}: позиция "${item.title}" (SKU "${item.variant_sku ?? "не указан"}") имеет недопустимое количество ${String(item.quantity)}.`
      )
    }
  }
}

async function resolveCounterparty(
  client: MoyskladClient,
  encryptedCredentials: string,
  order: OrderForSync
) {
  const name = [
    order.shipping_address?.first_name,
    order.shipping_address?.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim()

  if (order.email) {
    const existing = await client.findCounterpartyByEmail(
      encryptedCredentials,
      order.email
    )

    if (existing) {
      return existing
    }
  }

  return client.createCounterparty(encryptedCredentials, {
    name: name || order.email || order.id,
    email: order.email ?? undefined,
    phone: order.shipping_address?.phone ?? undefined,
  })
}

async function resolvePositions(
  client: MoyskladClient,
  encryptedCredentials: string,
  order: OrderForSync
) {
  const positions: MoyskladOrderPosition[] = []

  for (const item of order.items) {
    if (!item.variant_sku) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        `Товар "${item.title}" не имеет SKU и не может быть сопоставлен с МойСклад.`
      )
    }

    const products = await client.findProductsBySku(
      encryptedCredentials,
      item.variant_sku
    )

    if (products.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        `Товар с SKU "${item.variant_sku}" не найден в МойСклад.`
      )
    }

    if (products.length > 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        `SKU "${item.variant_sku}" соответствует нескольким товарам в МойСклад.`
      )
    }

    positions.push({
      assortmentHref: products[0].meta.href,
      quantity: item.quantity,
      priceRubles: item.unit_price,
    })
  }

  return positions
}

export const createMoyskladCustomerOrderStep = createStep(
  "create-moysklad-customer-order",
  async (input: CreateMoyskladCustomerOrderInput, { container }) => {
    const result = await createMoyskladCustomerOrder(container, input)

    return new StepResponse(result)
  }
)
