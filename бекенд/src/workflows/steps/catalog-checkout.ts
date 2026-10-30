import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  validateCatalogCartItems,
  type ValidatedCatalogCartItem,
} from "../../api/catalog/utils"
import type { CheckoutCatalogOrderBody } from "../../api/catalog/validators"
import { buildCatalogShippingAddressFields } from "./prepare-sync-catalog-shipping-address"
import {
  CDEK_PROVIDER_KEY,
  OZON_PROVIDER_KEY,
  SHIPPING_PROVIDER_REGISTRY_MODULE,
} from "../../modules/shipping-provider-registry"
import type ShippingProviderRegistryModuleService from "../../modules/shipping-provider-registry/service"
import { selectedVisibleDeliveryProviderKeys } from "../../modules/shipping-provider-registry/lifecycle-selection"
import {
  STORE_PICKUP_METADATA_KEYS,
  isStorePickupShippingOption,
  storePickupSnapshotFromMethods,
  type StorePickupSnapshot,
} from "../../modules/store-pickup/utils"

const MANUAL_FULFILLMENT_PROVIDER_ID = "manual_manual"

type CartLineForValidation = {
  variant_id?: string | null
  quantity?: number | string | null
}

type CartForValidation = {
  id?: string
  items?: CartLineForValidation[] | null
}

type CartForAddress = {
  id?: string
  metadata?: Record<string, unknown> | null
  shipping_address?: {
    country_code?: string | null
  } | null
  region?: {
    countries?: Array<{ iso_2?: string | null }> | null
  } | null
  shipping_methods?: Array<{
    data?: Record<string, unknown> | null
  }> | null
}

export type CheckoutPickupPoint = {
  id: string
  provider_key: string
  external_id: string
  name: string
  address: string
}

type HistoricalCheckoutPickupPoint = Omit<CheckoutPickupPoint, "provider_key" | "external_id">
type StoredCheckoutPickupPoint = CheckoutPickupPoint | HistoricalCheckoutPickupPoint

function hasExplicitPickupIdentity(
  point: Partial<CheckoutPickupPoint>
): point is CheckoutPickupPoint {
  return !!point.provider_key && !!point.external_id
}

// Пункт выдачи кладётся в способ доставки при его выборе
// (`resolve-catalog-pickup-point`) провайдер-нейтральным ключом, чтобы читать его
// здесь одним способом для всех провайдеров.
export function cartPickupPoint(
  cart: CartForAddress | undefined
): StoredCheckoutPickupPoint | null {
  for (const method of cart?.shipping_methods ?? []) {
    const point = method?.data?.pickup_point as Partial<CheckoutPickupPoint> | undefined
    if (point?.id && point.address) {
      const historicalPoint = {
        id: point.id,
        name: point.name ?? "",
        address: point.address,
      }

      return hasExplicitPickupIdentity(point)
        ? { ...historicalPoint, provider_key: point.provider_key, external_id: point.external_id }
        : historicalPoint
    }
  }

  return null
}

type CartForShipping = {
  id?: string
  items?: Array<{
    requires_shipping?: boolean | null
    variant?: {
      product?: {
        shipping_profile?: {
          id?: string | null
        } | null
      } | null
    } | null
  }> | null
  shipping_methods?: Array<{
    shipping_option?: {
      shipping_profile_id?: string | null
    } | null
  }> | null
}

type ShippingOption = {
  id?: string
  provider_id?: string | null
  shipping_profile_id?: string | null
  data?: Record<string, unknown> | null
}

type CatalogCheckoutCartUpdateInput = CheckoutCatalogOrderBody & {
  customer_id?: string | null
}

export class CatalogCheckoutCartValidationError extends Error {
  constructor(readonly items: ValidatedCatalogCartItem[]) {
    super("Cart contains unavailable items")
    this.name = "CatalogCheckoutCartValidationError"
  }
}

// Возвращает предикат, а не boolean: иначе `error` у вызывающего остаётся `unknown`
// и обращение к его полям не компилируется (TS18046).
function isCatalogCheckoutErrorNamed(
  error: unknown,
  name: string
): error is Record<string, unknown> {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === name
  )
}

export function isCatalogCheckoutCartValidationError(
  error: unknown
): error is { items: ValidatedCatalogCartItem[] } {
  return (
    isCatalogCheckoutErrorNamed(error, "CatalogCheckoutCartValidationError") &&
    "items" in error &&
    Array.isArray(error.items)
  )
}

function numberQuantity(value: number | string | null | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1
}

function firstCartCountry(cart: CartForAddress) {
  return (
    cart.shipping_address?.country_code ??
    cart.region?.countries?.find((country) => country.iso_2)?.iso_2 ??
    null
  )
}

function checkoutEmail(email: string) {
  return email.trim().toLowerCase()
}

type CheckoutAddressInput = {
  name: string
  phone: string
  street?: string
  house?: string
  apartment?: string
}

// A pickup-point (ПВЗ) checkout only carries a city — street/house/apartment
// are courier-only and, unlike `input.city`, optional. Only surfacing them
// here when actually present keeps the cart/order address metadata free of
// stray empty strings for pickup orders.
export function buildCheckoutAddressMetadata(input: CheckoutAddressInput) {
  return {
    ...(input.street ? { street: input.street } : {}),
    ...(input.house ? { house: input.house } : {}),
    ...(input.apartment ? { apartment: input.apartment } : {}),
  }
}

type CheckoutOrderMetadataInput = CheckoutAddressInput & {
  city: string
  comment: string
}

export function buildCheckoutOrderMetadata(
  input: CheckoutOrderMetadataInput,
  existingMetadata: Record<string, unknown> = {},
  pickupPoint: StoredCheckoutPickupPoint | null = null,
  storePickup: StorePickupSnapshot | null = null
) {
  const preservedMetadata = { ...existingMetadata }
  delete preservedMetadata[STORE_PICKUP_METADATA_KEYS.enabled]
  delete preservedMetadata[STORE_PICKUP_METADATA_KEYS.address]
  delete preservedMetadata[STORE_PICKUP_METADATA_KEYS.hours]
  delete preservedMetadata[STORE_PICKUP_METADATA_KEYS.collectedAt]

  return {
    ...preservedMetadata,
    checkout_comment: input.comment.trim(),
    checkout_contact_name: input.name,
    checkout_contact_phone: input.phone,
    checkout_address_city: input.city,
    ...(input.street ? { checkout_address_street: input.street } : {}),
    ...(input.house ? { checkout_address_house: input.house } : {}),
    ...(input.apartment ? { checkout_address_apartment: input.apartment } : {}),
    // Заказ должен отвечать, куда и каким способом он едет, не обращаясь к API
    // перевозчика: у самовывоза адресом назначения служит сам пункт выдачи.
    ...(pickupPoint
      ? {
          checkout_pickup_point_id: pickupPoint.id,
          ...(hasExplicitPickupIdentity(pickupPoint)
            ? { checkout_pickup_point_provider_key: pickupPoint.provider_key }
            : {}),
          ...(hasExplicitPickupIdentity(pickupPoint)
            ? { checkout_pickup_point_external_id: pickupPoint.external_id }
            : {}),
          checkout_pickup_point_name: pickupPoint.name,
          checkout_pickup_point_address: pickupPoint.address,
        }
      : {}),
    ...(storePickup
      ? {
          [STORE_PICKUP_METADATA_KEYS.enabled]: true,
          [STORE_PICKUP_METADATA_KEYS.address]: storePickup.address,
          [STORE_PICKUP_METADATA_KEYS.hours]: storePickup.hours,
        }
      : {}),
  }
}

async function retrieveCartForValidation(
  container: MedusaContainer,
  cartId: string
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph(
    {
      entity: "cart",
      fields: ["id", "items.variant_id", "items.quantity"],
      filters: { id: cartId },
    },
    { throwIfKeyNotFound: true }
  )

  return data[0] as CartForValidation | undefined
}

export async function getCatalogCheckoutCartValidation(
  container: MedusaContainer,
  cartId: string
) {
  const cart = await retrieveCartForValidation(container, cartId)

  if (!cart?.items?.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Cart is empty")
  }

  const items = cart.items.map((item) => {
    if (!item.variant_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cart item is missing variant"
      )
    }

    return {
      variant_id: item.variant_id,
      quantity: numberQuantity(item.quantity),
    }
  })

  return validateCatalogCartItems(container, items)
}

export const validateCatalogCheckoutCartStep = createStep(
  "validate-catalog-checkout-cart",
  async (input: { cart_id: string }, { container }) => {
    const items = await getCatalogCheckoutCartValidation(container, input.cart_id)

    if (items.some((item) => !item.purchasable)) {
      throw new CatalogCheckoutCartValidationError(items)
    }

    return new StepResponse({ items })
  }
)

export const prepareCatalogCheckoutCartUpdateStep = createStep(
  "prepare-catalog-checkout-cart-update",
  async (input: CatalogCheckoutCartUpdateInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph(
      {
        entity: "cart",
        fields: [
          "id",
          "metadata",
          "shipping_address.country_code",
          "region.countries.iso_2",
          "shipping_methods.data",
        ],
        filters: { id: input.cart_id },
      },
      { throwIfKeyNotFound: true }
    )

    const cart = data[0] as CartForAddress | undefined
    const countryCode = cart ? firstCartCountry(cart) : null

    if (!countryCode) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cart region does not include a country"
      )
    }

    // A pickup-point (ПВЗ) checkout only carries city — building address_1
    // straight from `input.street`/`input.house` would corrupt it to a literal
    // "undefined, undefined" (same failure mode already solved for the
    // shipping-address sync step, see buildCatalogShippingAddressFields).
    const addressFields = buildCatalogShippingAddressFields(input)
    const pickupPoint = cartPickupPoint(cart)
    const storePickup = storePickupSnapshotFromMethods(cart?.shipping_methods)

    const checkoutAddress = {
      first_name: input.name,
      phone: input.phone,
      city: addressFields.city,
      // Для самовывоза адрес назначения — адрес пункта выдачи: без этого заказ
      // хранит только город и идентификатор точки, и «куда он едет» приходится
      // выяснять в API перевозчика (issue #40).
      address_1: pickupPoint
        ? pickupPoint.address
        : storePickup
          ? undefined
          : addressFields.address_1,
      address_2: pickupPoint || storePickup ? undefined : addressFields.address_2,
      country_code: countryCode,
      metadata: buildCheckoutAddressMetadata(input),
    }

    return new StepResponse({
      id: input.cart_id,
      email: checkoutEmail(input.email),
      customer_id: input.customer_id ?? null,
      shipping_address: checkoutAddress,
      billing_address: checkoutAddress,
      metadata: buildCheckoutOrderMetadata(
        input,
        cart?.metadata ?? {},
        pickupPoint,
        storePickup
      ),
    })
  }
)

export class CatalogCheckoutShippingNotSelectedError extends Error {
  constructor() {
    super("Shipping method has not been selected for this cart")
    this.name = "CatalogCheckoutShippingNotSelectedError"
  }
}

export function isCatalogCheckoutShippingNotSelectedError(
  error: unknown
): boolean {
  return isCatalogCheckoutErrorNamed(
    error,
    "CatalogCheckoutShippingNotSelectedError"
  )
}

// Pure and synthetic-data-testable: silently falling back to a manual option
// when a direct delivery provider is available would lose the customer's
// selected service, method and pickup point.
export function resolveMissingProfileShippingOptions(
  missingProfileIds: string[],
  shippingOptions: ShippingOption[]
): Array<{ id: string }> {
  return missingProfileIds.map((profileId) => {
    const profileOptions = shippingOptions.filter(
      (option) => option.shipping_profile_id === profileId && option.id
    )

    const hasDirectDeliveryOption = profileOptions.some(
      (option) =>
        option.provider_id === CDEK_PROVIDER_KEY ||
        option.provider_id === OZON_PROVIDER_KEY
    )

    const hasStorePickupOption = profileOptions.some(isStorePickupShippingOption)

    if (hasDirectDeliveryOption || hasStorePickupOption) {
      throw new CatalogCheckoutShippingNotSelectedError()
    }

    const manualOption =
      profileOptions.find(
        (option) => option.provider_id === MANUAL_FULFILLMENT_PROVIDER_ID
      ) ?? profileOptions[0]

    if (!manualOption?.id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No shipping option is available for cart items"
      )
    }

    return { id: manualOption.id }
  })
}

export const prepareCatalogCheckoutShippingOptionsStep = createStep(
  "prepare-catalog-checkout-shipping-options",
  async (input: { cart_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph(
      {
        entity: "cart",
        fields: [
          "id",
          "items.requires_shipping",
          "items.variant.product.shipping_profile.id",
          "shipping_methods.shipping_option.shipping_profile_id",
        ],
        filters: { id: input.cart_id },
      },
      { throwIfKeyNotFound: true }
    )

    const cart = data[0] as CartForShipping | undefined
    const requiredProfileIds = Array.from(
      new Set(
        (cart?.items ?? [])
          .filter((item) => item.requires_shipping)
          .map((item) => item.variant?.product?.shipping_profile?.id)
          .filter((id): id is string => !!id)
      )
    )
    const coveredProfileIds = new Set(
      (cart?.shipping_methods ?? [])
        .map((method) => method.shipping_option?.shipping_profile_id)
        .filter((id): id is string => !!id)
    )
    const missingProfileIds = requiredProfileIds.filter(
      (id) => !coveredProfileIds.has(id)
    )

    if (!missingProfileIds.length) {
      return new StepResponse({ options: [] as Array<{ id: string }> })
    }

    const { data: shippingOptions } = await query.graph({
      entity: "shipping_option",
      fields: ["id", "provider_id", "shipping_profile_id", "data"],
      filters: { shipping_profile_id: missingProfileIds },
    })

    const options = resolveMissingProfileShippingOptions(
      missingProfileIds,
      shippingOptions as ShippingOption[]
    )

    return new StepResponse({ options })
  }
)

export const retrieveCatalogCartPaymentCollectionStep = createStep(
  "retrieve-catalog-cart-payment-collection",
  async (input: { cart_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph(
      {
        entity: "cart",
        fields: ["id", "payment_collection.id"],
        filters: { id: input.cart_id },
      },
      { throwIfKeyNotFound: true }
    )
    const cart = data[0] as { payment_collection?: { id?: string } | null }

    return new StepResponse({ id: cart.payment_collection?.id ?? null })
  }
)

export function resolveCatalogPaymentCollectionId(input: {
  existing_payment_collection: { id: string | null }
  created_payment_collection?: { id?: string } | null
}) {
  const id =
    input.existing_payment_collection.id ?? input.created_payment_collection?.id

  if (!id) {
    throw new Error("Payment collection was not created")
  }

  return id
}

export const resolveCatalogPaymentCollectionIdStep = createStep(
  "resolve-catalog-payment-collection-id",
  (input: {
    existing_payment_collection: { id: string | null }
    created_payment_collection?: { id?: string } | null
  }) => new StepResponse(resolveCatalogPaymentCollectionId(input))
)

export class CatalogCheckoutShippingProviderHiddenError extends Error {
  constructor() {
    super("Selected shipping provider is no longer available")
    this.name = "CatalogCheckoutShippingProviderHiddenError"
  }
}

export function isCatalogCheckoutShippingProviderHiddenError(
  error: unknown
): boolean {
  return isCatalogCheckoutErrorNamed(
    error,
    "CatalogCheckoutShippingProviderHiddenError"
  )
}

type CartForShippingProviderCheck = {
  shipping_methods?: Array<{
    shipping_option?: { provider_id?: string | null } | null
  }> | null
}

// Re-checks only the registry visibility flag (T03/T04) already applied when
// the cart's shipping method was chosen — never re-queries a provider
// itself, since the calculated price is not re-verified at checkout time (Ф3).
export const checkCatalogCheckoutShippingProviderVisibilityStep = createStep(
  "check-catalog-checkout-shipping-provider-visibility",
  async (input: { cart_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph(
      {
        entity: "cart",
        fields: ["id", "shipping_methods.shipping_option.provider_id"],
        filters: { id: input.cart_id },
      },
      { throwIfKeyNotFound: true }
    )
    const cart = data[0] as CartForShippingProviderCheck | undefined

    const providerKeys = selectedVisibleDeliveryProviderKeys(cart)
    if (!providerKeys.length) {
      return new StepResponse({ checked: true })
    }

    const registryService: ShippingProviderRegistryModuleService = container.resolve(
      SHIPPING_PROVIDER_REGISTRY_MODULE
    )
    for (const providerKey of providerKeys) {
      const [visibility] = await registryService.listShippingProviderVisibilities({
        provider_key: providerKey,
      })
      if (!visibility?.is_visible) {
        throw new CatalogCheckoutShippingProviderHiddenError()
      }
    }

    return new StepResponse({ checked: true })
  }
)
