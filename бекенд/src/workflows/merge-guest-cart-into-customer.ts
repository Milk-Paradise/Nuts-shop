import type {
  ICartModuleService,
  ILockingModule,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { refreshCartItemsWorkflow } from "@medusajs/medusa/core-flows"

import {
  validateCatalogCartItems,
  type ValidatedCatalogCartItem,
} from "../api/catalog/utils"
import { CART_MERGE_OPERATION_MODULE } from "../modules/cart-merge-operation"
import type CartMergeOperationModuleService from "../modules/cart-merge-operation/service"
import { CART_VERSIONING_MODULE } from "../modules/cart"
import type CartVersioningService from "../modules/cart/service"

export type MergeGuestCartIntoCustomerInput = {
  customerId: string
  guestCartId: string
}

const MAX_MERGED_LINE_QUANTITY = 99
const MERGE_LOCK_RETRIES = 5

type CartLine = {
  id: string
  variant_id: string | null
  quantity: number
  title: string
  subtitle: string | null
  thumbnail: string | null
  product_id: string | null
  product_title: string | null
  product_description: string | null
  product_subtitle: string | null
  product_type: string | null
  product_type_id: string | null
  product_collection: string | null
  product_handle: string | null
  variant_sku: string | null
  variant_barcode: string | null
  variant_title: string | null
  variant_option_values: Record<string, unknown> | null
  requires_shipping: boolean | null
  is_discountable: boolean | null
  is_tax_inclusive: boolean | null
  unit_price: number
  metadata: Record<string, unknown> | null
}

type CartRecord = {
  id: string
  customer_id: string | null
  completed_at: string | Date | null
  created_at: string | Date
  version: number
  items: CartLine[] | null
}

type CartMergeOperation = {
  id: string
  guest_cart_id: string
  customer_id: string
  result_cart_id: string
  state: "refresh_pending" | "completed"
}

type MergeAvailability = {
  line_item_id: string
  variant_id: string | null
  quantity: number
  purchasable: boolean
  problem: string | null
  available_quantity: number | null
  allowed_quantity: number
}

const lineItemFields = [
  "id",
  "variant_id",
  "quantity",
  "title",
  "subtitle",
  "thumbnail",
  "product_id",
  "product_title",
  "product_description",
  "product_subtitle",
  "product_type",
  "product_type_id",
  "product_collection",
  "product_handle",
  "variant_sku",
  "variant_barcode",
  "variant_title",
  "variant_option_values",
  "requires_shipping",
  "is_discountable",
  "is_tax_inclusive",
  "unit_price",
  "metadata",
]

const cartFields = [
  "id",
  "customer_id",
  "completed_at",
  "created_at",
  "version",
  ...lineItemFields.map((field) => `items.${field}`),
]

type MergeLinePlan = {
  existing: CartLine | null
  guest: CartLine
  desiredQuantity: number
  quantity: number
  validation?: ValidatedCatalogCartItem
}

type MergeAttemptResult =
  | { retry: true }
  | { retry: false; cartId: string; items: MergeAvailability[] }
  | {
      retry: false
      refresh: {
        operation: CartMergeOperation
        touchedItems?: unknown[]
      }
    }

type CartQuery = {
  graph(input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }): Promise<{ data: Array<Record<string, unknown>> }>
}

function quantity(value: number | string | null | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1
}

function newestCart(carts: CartRecord[]) {
  return [...carts].sort((left, right) => {
    const dateDifference =
      new Date(right.created_at ?? 0).getTime() -
      new Date(left.created_at ?? 0).getTime()

    return dateDifference || right.id.localeCompare(left.id)
  })[0] ?? null
}

async function readCustomerCarts(
  query: CartQuery,
  customerId: string,
  guestCartId: string
) {
  const { data: accountCarts } = await query.graph({
    entity: "cart",
    fields: cartFields,
    filters: { customer_id: customerId, completed_at: null },
  })
  const { data: guestCarts } = await query.graph({
    entity: "cart",
    fields: cartFields,
    filters: { id: guestCartId },
  })

  const accountCart = newestCart(
    (accountCarts as unknown as CartRecord[]).filter(
      (cart) => cart.id !== guestCartId
    )
  )
  const guestCart = (guestCarts as unknown as CartRecord[])[0] ?? null

  return { accountCart, guestCart }
}

async function findMergeOperation(
  service: CartMergeOperationModuleService,
  guestCartId: string
) {
  const [operation] = await service.listCartMergeOperations(
    { guest_cart_id: guestCartId },
    { take: 1 }
  )

  return (operation as CartMergeOperation | undefined) ?? null
}

function mergeMetadata(
  existing: Record<string, unknown> | null,
  guest: Record<string, unknown> | null
) {
  if (!existing && !guest) {
    return undefined
  }

  return { ...(guest ?? {}), ...(existing ?? {}) }
}

function lineInput(item: CartLine, lineQuantity: number) {
  return {
    title: item.title,
    subtitle: item.subtitle ?? undefined,
    thumbnail: item.thumbnail ?? undefined,
    quantity: lineQuantity,
    product_id: item.product_id ?? undefined,
    product_title: item.product_title ?? undefined,
    product_description: item.product_description ?? undefined,
    product_subtitle: item.product_subtitle ?? undefined,
    product_type: item.product_type ?? undefined,
    product_type_id: item.product_type_id ?? undefined,
    product_collection: item.product_collection ?? undefined,
    product_handle: item.product_handle ?? undefined,
    variant_id: item.variant_id ?? undefined,
    variant_sku: item.variant_sku ?? undefined,
    variant_barcode: item.variant_barcode ?? undefined,
    variant_title: item.variant_title ?? undefined,
    variant_option_values: item.variant_option_values ?? undefined,
    requires_shipping: item.requires_shipping ?? undefined,
    is_discountable: item.is_discountable ?? undefined,
    is_tax_inclusive: item.is_tax_inclusive ?? undefined,
    unit_price: item.unit_price,
    metadata: item.metadata ?? undefined,
  }
}

async function planMergeLines(
  container: MedusaContainer,
  accountCart: CartRecord | null,
  guestCart: CartRecord
): Promise<MergeLinePlan[]> {
  const existingItems = accountCart?.items ?? []
  const plans: MergeLinePlan[] = []
  const planByVariant = new Map<string, MergeLinePlan>()

  for (const guestItem of guestCart.items ?? []) {
    const existing = guestItem.variant_id
      ? existingItems.find((item) => item.variant_id === guestItem.variant_id) ?? null
      : null
    const repeated = guestItem.variant_id
      ? planByVariant.get(guestItem.variant_id)
      : undefined

    if (repeated) {
      repeated.desiredQuantity = Math.max(
        repeated.desiredQuantity,
        quantity(guestItem.quantity)
      )
      repeated.guest = {
        ...repeated.guest,
        metadata: mergeMetadata(repeated.guest.metadata, guestItem.metadata) ?? null,
      }
      continue
    }

    const desiredQuantity = Math.max(
      existing ? quantity(existing.quantity) : 0,
      quantity(guestItem.quantity)
    )
    const plan: MergeLinePlan = {
      existing,
      guest: guestItem,
      desiredQuantity,
      quantity: Math.min(MAX_MERGED_LINE_QUANTITY, desiredQuantity),
    }
    plans.push(plan)

    if (guestItem.variant_id) {
      planByVariant.set(guestItem.variant_id, plan)
    }
  }

  const variantPlans = plans.filter((plan) => plan.guest.variant_id)
  if (!variantPlans.length) {
    return plans
  }

  const validated = await validateCatalogCartItems(
    container,
    variantPlans.map((plan) => ({
      variant_id: plan.guest.variant_id!,
      quantity: plan.desiredQuantity,
    }))
  )
  const byVariant = new Map(validated.map((item) => [item.variant_id, item]))

  for (const plan of variantPlans) {
    const validation = byVariant.get(plan.guest.variant_id!)
    plan.validation = validation

    const stockMaximum = validation?.product?.max_quantity
    if (stockMaximum !== null && stockMaximum !== undefined && stockMaximum > 0) {
      plan.quantity = Math.min(plan.quantity, stockMaximum)
    }
  }

  return plans
}

async function transferGuestCart(
  container: MedusaContainer,
  guestCart: CartRecord,
  customerId: string,
  operationService: CartMergeOperationModuleService
) {
  const cartService = container.resolve<ICartModuleService>(Modules.CART)
  const versioning = container.resolve<CartVersioningService>(CART_VERSIONING_MODULE)
  const plans = await planMergeLines(container, null, guestCart)

  const operation = await operationService.createCartMergeOperations({
    guest_cart_id: guestCart.id,
    customer_id: customerId,
    result_cart_id: guestCart.id,
    state: "refresh_pending",
  })

  for (const plan of plans) {
    const line = plan.guest
    if (plan.quantity !== quantity(line.quantity)) {
      await cartService.updateLineItems(line.id, { quantity: plan.quantity })
    }
  }

  const guestCartVersion = (await versioning.getVersion(guestCart.id))!
  await versioning.updateCartByVersion(
    guestCart.id,
    guestCartVersion,
    { customer_id: customerId }
  )

  return { operationId: operation.id, cartId: guestCart.id, touchedItems: [] }
}

async function mergeIntoAccountCart(
  container: MedusaContainer,
  guestCart: CartRecord,
  accountCart: CartRecord,
  customerId: string,
  operationService: CartMergeOperationModuleService
) {
  const cartService = container.resolve<ICartModuleService>(Modules.CART)
  const versioning = container.resolve<CartVersioningService>(CART_VERSIONING_MODULE)
  const plans = await planMergeLines(container, accountCart, guestCart)

  const operation = await operationService.createCartMergeOperations({
    guest_cart_id: guestCart.id,
    customer_id: customerId,
    result_cart_id: accountCart.id,
    state: "refresh_pending",
  })
  const touchedItems: unknown[] = []

  for (const plan of plans) {
    if (plan.existing) {
      const data: Record<string, unknown> = {}
      if (quantity(plan.existing.quantity) !== plan.quantity) {
        data.quantity = plan.quantity
      }
      const metadata = mergeMetadata(plan.existing.metadata, plan.guest.metadata)
      if (metadata) {
        data.metadata = metadata
      }

      if (Object.keys(data).length) {
        touchedItems.push(await cartService.updateLineItems(plan.existing.id, data))
      }
      continue
    }

    const [created] = await cartService.addLineItems(
      accountCart.id,
      [lineInput(plan.guest, plan.quantity)]
    )
    touchedItems.push(created)
  }

  const accountCartVersion = (await versioning.getVersion(accountCart.id))!
  await versioning.updateCartByVersion(accountCart.id, accountCartVersion, {})
  const guestCartVersion = (await versioning.getVersion(guestCart.id))!
  await versioning.updateCartByVersion(
    guestCart.id,
    guestCartVersion,
    { completed_at: new Date() }
  )

  return {
    operationId: operation.id,
    cartId: accountCart.id,
    touchedItems,
  }
}

async function cartAvailability(
  container: MedusaContainer,
  cartId: string
): Promise<MergeAvailability[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as CartQuery
  const { data } = await (query as CartQuery).graph({
    entity: "cart",
    fields: ["items.id", "items.variant_id", "items.quantity"],
    filters: { id: cartId },
  })
  const lines = (data?.[0]?.items ?? []) as Array<{
    id: string
    variant_id: string | null
    quantity: number
  }>
  const variantLines = lines.filter(
    (line): line is typeof line & { variant_id: string } => !!line.variant_id
  )
  const validated = variantLines.length
    ? await validateCatalogCartItems(
        container,
        variantLines.map((line) => ({
          variant_id: line.variant_id,
          quantity: quantity(line.quantity),
        }))
      )
    : []

  let validationIndex = 0
  return lines.map((line) => {
    if (!line.variant_id) {
      return {
        line_item_id: line.id,
        variant_id: null,
        quantity: quantity(line.quantity),
        purchasable: false,
        problem: "not_found",
        available_quantity: null,
        allowed_quantity: 0,
      }
    }

    const item = validated[validationIndex++]
    const maxQuantity = item?.product?.max_quantity

    return {
      line_item_id: line.id,
      variant_id: line.variant_id,
      quantity: quantity(line.quantity),
      purchasable: item?.purchasable ?? false,
      problem: item?.problem ?? "not_found",
      available_quantity: item?.available_quantity ?? null,
      allowed_quantity:
        item?.product == null
          ? 0
          : maxQuantity == null
            ? MAX_MERGED_LINE_QUANTITY
            : Math.min(MAX_MERGED_LINE_QUANTITY, maxQuantity),
    }
  })
}

async function refreshAndComplete(
  container: MedusaContainer,
  operationService: CartMergeOperationModuleService,
  operation: CartMergeOperation,
  touchedItems?: unknown[]
) {
  const input = touchedItems
    ? { cart_id: operation.result_cart_id, items: touchedItems }
    : { cart_id: operation.result_cart_id, force_refresh: true }

  await refreshCartItemsWorkflow(container).run({ input })
  await operationService.updateCartMergeOperations({
    id: operation.id,
    state: "completed",
  })

  return {
    cartId: operation.result_cart_id,
    items: await cartAvailability(container, operation.result_cart_id),
  }
}

function lockedTargetCartId(
  operation: CartMergeOperation | null,
  customerId: string,
  accountCart: CartRecord | null,
  guestCart: CartRecord | null
) {
  if (operation?.customer_id === customerId) {
    return operation.result_cart_id
  }

  if (accountCart) {
    return accountCart.id
  }

  if (guestCart && !guestCart.customer_id && !guestCart.completed_at) {
    return guestCart.id
  }

  return null
}

export async function mergeGuestCartIntoCustomer(
  container: MedusaContainer,
  input: MergeGuestCartIntoCustomerInput
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as CartQuery
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const operationService = container.resolve<CartMergeOperationModuleService>(
    CART_MERGE_OPERATION_MODULE
  )

  for (let attempt = 0; attempt < MERGE_LOCK_RETRIES; attempt += 1) {
    const operationSnapshot = await findMergeOperation(
      operationService,
      input.guestCartId
    )
    const snapshot = await readCustomerCarts(
      query,
      input.customerId,
      input.guestCartId
    )
    const expectedTargetCartId = lockedTargetCartId(
      operationSnapshot,
      input.customerId,
      snapshot.accountCart,
      snapshot.guestCart
    )
    const lockKeys = [
      `cart-merge-customer:${input.customerId}`,
      input.guestCartId,
      ...(expectedTargetCartId ? [expectedTargetCartId] : []),
    ].sort()

    const result = await locking.execute(lockKeys, async (): Promise<MergeAttemptResult> => {
      const operation = await findMergeOperation(
        operationService,
        input.guestCartId
      )

      if (operation?.customer_id === input.customerId) {
        if (operation.result_cart_id !== expectedTargetCartId) {
          return { retry: true }
        }

        if (operation.state === "refresh_pending") {
          return {
            retry: false,
            refresh: { operation },
          }
        }

        return {
          retry: false,
          cartId: operation.result_cart_id,
          items: await cartAvailability(container, operation.result_cart_id),
        }
      }

      const { accountCart, guestCart } = await readCustomerCarts(
        query,
        input.customerId,
        input.guestCartId
      )
      const currentTargetCartId = lockedTargetCartId(
        operation,
        input.customerId,
        accountCart,
        guestCart
      )

      if (currentTargetCartId !== expectedTargetCartId) {
        return { retry: true }
      }

      if (!guestCart) {
        const cartId = accountCart?.id ?? input.guestCartId
        return {
          retry: false,
          cartId,
          items: accountCart
            ? await cartAvailability(container, accountCart.id)
            : [],
        }
      }

      if (guestCart.completed_at) {
        const cartId = accountCart?.id ?? input.guestCartId
        return {
          retry: false,
          cartId,
          items: accountCart
            ? await cartAvailability(container, accountCart.id)
            : [],
        }
      }

      if (guestCart.customer_id === input.customerId) {
        return {
          retry: false,
          cartId: guestCart.id,
          items: await cartAvailability(container, guestCart.id),
        }
      }

      if (guestCart.customer_id) {
        return {
          retry: false,
          cartId: accountCart?.id ?? input.guestCartId,
          items: accountCart
            ? await cartAvailability(container, accountCart.id)
            : [],
        }
      }

      if (!(guestCart.items ?? []).length) {
        return {
          retry: false,
          cartId: accountCart?.id ?? guestCart.id,
          items: accountCart
            ? await cartAvailability(container, accountCart.id)
            : await cartAvailability(container, guestCart.id),
        }
      }

      const committed = accountCart
        ? await mergeIntoAccountCart(
            container,
            guestCart,
            accountCart,
            input.customerId,
            operationService
          )
        : await transferGuestCart(
            container,
            guestCart,
            input.customerId,
            operationService
          )
      const persistedOperation = (await findMergeOperation(
        operationService,
        input.guestCartId
      )) as CartMergeOperation | null

      if (!persistedOperation || persistedOperation.id !== committed.operationId) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Cart merge operation for ${input.guestCartId} was not persisted`
        )
      }

      return {
        retry: false,
        refresh: {
          operation: persistedOperation,
          touchedItems: committed.touchedItems.length
            ? committed.touchedItems
            : undefined,
        },
      }
    })

    if (result.retry) {
      continue
    }

    if ("refresh" in result) {
      return refreshAndComplete(
        container,
        operationService,
        result.refresh.operation,
        result.refresh.touchedItems
      )
    }

    return { cartId: result.cartId, items: result.items }
  }

  throw new MedusaError(
    MedusaError.Types.CONFLICT,
    `Cart ${input.guestCartId} changed repeatedly while it was being merged`
  )
}
