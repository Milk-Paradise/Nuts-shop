import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

import type {
  CheckCatalogPaymentStatusBody,
  CheckoutCatalogOrderBody,
  GetCatalogSearchQuery,
  GetCategoryProductsQuery,
  GetPickupPointsQuery,
  GetShippingOptionsQuery,
  GetShippingTariffsQuery,
  InitiateCatalogPaymentBody,
  SelectCatalogShippingOptionBody,
  SyncCatalogShippingAddressBody,
  ValidateCatalogCartBody,
} from "./validators"
import {
  listNewCatalogProducts,
  listPromotedCatalogProducts,
  retrieveCatalogProduct,
  validateCatalogCart,
  validateCatalogCartItems,
  type CatalogProduct,
  type CatalogProductDetail,
  type ValidatedCatalogCartItem,
  type ValidatedCartItem,
} from "./utils"
import { listCatalogBrands } from "./brands/utils"
import { listCategoryTree, type CategoryTreeNode } from "./categories/utils"
import {
  listCategoryProducts,
  type CategoryProductsResponse,
} from "./categories/[handle]/products/utils"
import {
  searchCatalogProducts,
  type CatalogSearchResponseBody,
} from "./search/utils"
import {
  listConnectedShippingServices,
  listNormalizedPickupPointCatalog,
  listNormalizedShippingOptionsWithErrors,
  listPublicShippingTariffs,
  type NormalizedPickupPointsResult,
  type NormalizedShippingOptionsResult,
  type NormalizedShippingService,
  type PublicShippingTariffsResult,
} from "./shipping/utils"
import {
  CART_FROZEN_MESSAGES,
  getCartFreezeState,
  type CartFreezeReason,
} from "./cart-freeze"
import { isCartLockError } from "../cart-lock-error-handler"
import { createEmptyCmsHomepage, fetchDraftHomepage, type CmsHomepage } from "../../lib/cms-content"
import { filterInvalidCmsBanners } from "../../lib/cms-commerce-targets"
import { setPreviewResponseHeaders, verifyPreviewToken } from "../../lib/cms-preview"
import { CMS_HOMEPAGE_SNAPSHOT_KEY, readCmsSnapshot } from "../../lib/cms-snapshot"
import {
  isCatalogOrderFixationConflictError,
} from "../../lib/catalog-order-fixation"
import { PAYMENT_PROVIDER_CONFIG_MODULE } from "../../modules/payment-provider-config"
import { getRegisteredPaymentProvider } from "../../modules/payment-provider-config/registry"
import type PaymentProviderConfigModuleService from "../../modules/payment-provider-config/service"
import { SITE_CONTENT_MODULE } from "../../modules/site-content/module-key"
import { SITE_TAB_KEYS } from "../../modules/site-content/models/site-tab"
import type SiteContentModuleService from "../../modules/site-content/service"
import { finalizeCatalogOnlinePaymentWorkflow } from "../../workflows/finalize-catalog-online-payment"
import { initiateCatalogOnlinePaymentWorkflow } from "../../workflows/initiate-catalog-online-payment"
import { placeCatalogOrderWorkflow } from "../../workflows/place-catalog-order"
import {
  CDEK_WEBHOOK_SIGNATURE_HEADER,
  processCdekWebhook,
} from "../../workflows/process-cdek-webhook"
import { selectCatalogShippingMethodWorkflow } from "../../workflows/select-catalog-shipping-method"
import { syncCatalogShippingAddressWorkflow } from "../../workflows/sync-catalog-shipping-address"
import {
  getCatalogCheckoutCartValidation,
  isCatalogCheckoutCartValidationError,
  isCatalogCheckoutShippingNotSelectedError,
  isCatalogCheckoutShippingProviderHiddenError,
} from "../../workflows/steps/catalog-checkout"
import { storePickupOrderState } from "../../modules/store-pickup/utils"

export async function getCatalogBrands(
  req: MedusaRequest,
  res: MedusaResponse<{ brands: string[] }>
) {
  const brands = await listCatalogBrands(req.scope)
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  return res.status(200).json({ brands })
}

export async function getCatalogSearch(
  req: MedusaRequest<{}, GetCatalogSearchQuery>,
  res: MedusaResponse<CatalogSearchResponseBody>
) {
  const result = await searchCatalogProducts(
    req.scope,
    req.validatedQuery as GetCatalogSearchQuery
  )

  return res.status(200).json(result)
}

export async function getCategoryTree(
  req: MedusaRequest,
  res: MedusaResponse<{ categories: CategoryTreeNode[] }>
) {
  const categories = await listCategoryTree(req.scope)

  return res.status(200).json({ categories })
}

export async function getCategoryProducts(
  req: MedusaRequest<{}, GetCategoryProductsQuery>,
  res: MedusaResponse<CategoryProductsResponse>
) {
  const result = await listCategoryProducts(
    req.scope,
    req.params.handle,
    req.validatedQuery.page,
    req.validatedQuery.subcategory
  )

  return res.status(200).json(result)
}

export async function getCatalogProduct(
  req: MedusaRequest,
  res: MedusaResponse<{ product: CatalogProductDetail }>
) {
  const product = await retrieveCatalogProduct(req.scope, req.params.id)

  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found")
  }

  return res.status(200).json({ product })
}

export async function getPromotedCatalogProducts(
  req: MedusaRequest,
  res: MedusaResponse<{ products: CatalogProduct[] }>
) {
  const products = await listPromotedCatalogProducts(req.scope)

  return res.status(200).json({ products })
}

export async function getNewCatalogProducts(
  req: MedusaRequest,
  res: MedusaResponse<{ products: CatalogProduct[] }>
) {
  const products = await listNewCatalogProducts(req.scope)

  return res.status(200).json({ products })
}

export async function getSiteContent(req: MedusaRequest, res: MedusaResponse) {
  const siteContentService = req.scope.resolve(
    SITE_CONTENT_MODULE
  ) as SiteContentModuleService

  const [existingTabs, links] = await Promise.all([
    siteContentService.listSiteTabs({ key: [...SITE_TAB_KEYS] }),
    siteContentService.listSiteLinks({}, { order: { rank: "ASC" } }),
  ])

  const tabsByKey = new Map(existingTabs.map((tab) => [tab.key, tab]))
  const tabs = SITE_TAB_KEYS.map((key) => ({
    key,
    // Незаполненная вкладка возвращается с content: "" — плейсхолдер
    // формируется на стороне сторфронта (T10), а не здесь.
    content: tabsByKey.get(key)?.content ?? "",
  }))

  const socialLinks = links
    .filter((link) => link.kind === "social")
    .map((link) => ({ label: link.label, url: link.url }))

  const reviewsLink = links.find((link) => link.kind === "reviews")

  return res.status(200).json({
    tabs,
    social_links: socialLinks,
    reviews_url: reviewsLink?.url ?? null,
  })
}

export async function getCatalogHomepage(
  req: MedusaRequest,
  res: MedusaResponse<CmsHomepage>
) {
  const content = await readCmsSnapshot<CmsHomepage>(req.scope, CMS_HOMEPAGE_SNAPSHOT_KEY)
  res.setHeader("Cache-Control", "no-store")
  return res.status(200).json(
    content ?? createEmptyCmsHomepage(process.env.STOREFRONT_COMPANY_NAME)
  )
}

export async function getCatalogHomepagePreview(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const token = typeof req.query.token === "string" ? req.query.token : ""
  const secret = process.env.CMS_PREVIEW_SIGNING_SECRET
  const fixtureToken = process.env.CMS_PREVIEW_E2E_TOKEN
  const isFixtureToken =
    process.env.E2E_RUN === "true" && Boolean(fixtureToken) && token === fixtureToken

  if (!isFixtureToken && (!secret || !verifyPreviewToken(token, secret))) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Invalid or expired preview link"
    )
  }

  const content = await filterInvalidCmsBanners(
    req.scope,
    await fetchDraftHomepage()
  )
  setPreviewResponseHeaders(res)
  return res.status(200).json({ ...content, preview: true })
}

export async function validateCatalogCartRequest(
  req: MedusaRequest<ValidateCatalogCartBody>,
  res: MedusaResponse<{ items: Array<ValidatedCartItem | ValidatedCatalogCartItem> }>
) {
  const items = req.validatedBody.items?.length
    ? await validateCatalogCartItems(req.scope, req.validatedBody.items)
    : await validateCatalogCart(req.scope, req.validatedBody.skus ?? [])

  return res.status(200).json({ items })
}

export async function getCatalogCartState(
  req: MedusaRequest,
  res: MedusaResponse<{
    frozen: boolean
    reason: CartFreezeReason | null
    message: string | null
  }>
) {
  const cartId = (req.params as { id?: string })?.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "metadata",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.created_at",
    ],
    filters: { id: cartId },
  })
  const state = getCartFreezeState(data?.[0])

  return res.status(200).json({
    frozen: state.frozen,
    reason: state.reason,
    message: state.reason ? CART_FROZEN_MESSAGES[state.reason] : null,
  })
}

type CatalogCheckoutOrder = {
  id: string
  display_id: number | null
  store_pickup?: {
    address: string
    hours: string
  }
}

type CatalogCheckoutOrderResponse = {
  type: "order"
  order: CatalogCheckoutOrder
}

type CatalogCheckoutCartProblemResponse = {
  type: "cart"
  message: string
  items: ValidatedCatalogCartItem[]
}

type CatalogCheckoutShippingProblemResponse = {
  type: "shipping"
  message: string
}

type CatalogCheckoutConflictResponse = {
  type: "checkout"
  message: string
}

type CatalogCheckoutResponse =
  | CatalogCheckoutOrderResponse
  | CatalogCheckoutCartProblemResponse
  | CatalogCheckoutShippingProblemResponse
  | CatalogCheckoutConflictResponse

type OptionalCheckoutCustomerAuthRequest = MedusaRequest<CheckoutCatalogOrderBody> & {
  auth_context?: {
    actor_id?: string
  }
}

async function retrieveOrder(
  scope: MedusaRequest["scope"],
  orderId: string
): Promise<CatalogCheckoutOrder> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph(
    {
      entity: "order",
      fields: ["id", "display_id", "metadata"],
      filters: { id: orderId },
    },
    { throwIfKeyNotFound: true }
  )
  const order = data[0] as {
    id: string
    display_id?: number | null
    metadata?: Record<string, unknown> | null
  }
  const pickup = storePickupOrderState(order.metadata)

  return {
    id: order.id,
    display_id: order.display_id ?? null,
    ...(pickup
      ? { store_pickup: { address: pickup.address, hours: pickup.hours } }
      : {}),
  }
}

function cartProblemResponse(
  items: ValidatedCatalogCartItem[]
): CatalogCheckoutCartProblemResponse {
  return {
    type: "cart",
    message: "Cart contains unavailable items",
    items,
  }
}

async function validationResponseAfterFailure(
  scope: MedusaRequest["scope"],
  cartId: string
) {
  let items: ValidatedCatalogCartItem[]

  try {
    items = await getCatalogCheckoutCartValidation(scope, cartId)
  } catch {
    return null
  }

  return items.some((item) => !item.purchasable)
    ? cartProblemResponse(items)
    : null
}

export async function checkoutCatalogOrder(
  req: OptionalCheckoutCustomerAuthRequest,
  res: MedusaResponse<CatalogCheckoutResponse>
) {
  const input = {
    ...req.validatedBody,
    customer_id: req.auth_context?.actor_id ?? null,
  }

  try {
    const { result } = await placeCatalogOrderWorkflow(req.scope).run({
      input,
    })
    const order = await retrieveOrder(req.scope, result.order_id)

    return res.status(200).json({ type: "order", order })
  } catch (error) {
    if (isCatalogOrderFixationConflictError(error)) {
      return res.status(409).json({
        type: "checkout",
        message: "Checkout request conflicts with the order already created for this cart",
      })
    }

    if (isCatalogCheckoutCartValidationError(error)) {
      return res.status(409).json(cartProblemResponse(error.items))
    }

    if (isCatalogCheckoutShippingProviderHiddenError(error)) {
      return res.status(409).json({
        type: "shipping",
        message: "Selected shipping method is no longer available",
      })
    }

    if (isCatalogCheckoutShippingNotSelectedError(error)) {
      return res.status(409).json({
        type: "shipping",
        message: "Shipping method has not been selected",
      })
    }

    const validation = await validationResponseAfterFailure(
      req.scope,
      req.validatedBody.cart_id
    )

    if (validation) {
      return res.status(409).json(validation)
    }

    throw error
  }
}

export async function getCatalogPaymentProviders(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_region_id"],
  })
  const store = stores[0]
  const service = req.scope.resolve(
    PAYMENT_PROVIDER_CONFIG_MODULE
  ) as PaymentProviderConfigModuleService

  return res.json({
    payment_providers:
      store?.id && store.default_region_id
        ? await service.listStorePaymentProviders({
            store_id: store.id,
            region_id: store.default_region_id,
          })
        : [],
  })
}

type OptionalPaymentCustomerAuthRequest = MedusaRequest<InitiateCatalogPaymentBody> & {
  auth_context?: {
    actor_id?: string
  }
}

function allowedReturnUrl(returnUrl: string) {
  const allowedOrigins = (process.env.STORE_CORS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
  const origin = new URL(returnUrl).origin

  return allowedOrigins.includes(origin)
}

function errorMessage(error: unknown) {
  if (error instanceof Error || typeof error === "string") {
    return error instanceof Error ? error.message : error
  }

  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>

    for (const key of ["message", "error", "detail", "cause"]) {
      const value = candidate[key]

      if (typeof value === "string") {
        return value
      }

      if (value instanceof Error) {
        return value.message
      }
    }
  }

  return "Unknown error"
}

export async function initiateCatalogPayment(
  req: OptionalPaymentCustomerAuthRequest,
  res: MedusaResponse
) {
  if (!allowedReturnUrl(req.validatedBody.return_url)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Адрес возврата после оплаты не разрешён"
    )
  }

  try {
    const locking = req.scope.resolve(Modules.LOCKING)
    const provider = getRegisteredPaymentProvider(req.validatedBody.provider_id)
    const canonicalProviderId = provider?.id ?? req.validatedBody.provider_id
    const result = await locking.execute(
      `catalog-payment-init:${req.validatedBody.order_id}:${canonicalProviderId}`,
      async () => {
        const { result } = await initiateCatalogOnlinePaymentWorkflow(
          req.scope
        ).run({
          input: {
            ...req.validatedBody,
            customer_id: req.auth_context?.actor_id ?? null,
          },
        })

        return result
      },
      { timeout: 120 }
    )

    return res.status(200).json({ payment: result })
  } catch (error) {
    if (error instanceof MedusaError) {
      throw error
    }

    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error("Online payment initiation failed: " + errorMessage(error))

    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Не удалось начать оплату заказа — попробуйте ещё раз."
    )
  }
}

const DO_NOT_WAIT_FOR_LOCK = 0

export async function getCatalogPaymentStatus(
  req: MedusaRequest<CheckCatalogPaymentStatusBody>,
  res: MedusaResponse
) {
  try {
    const { result } = await finalizeCatalogOnlinePaymentWorkflow(req.scope).run({
      input: {
        cart_id: req.validatedBody.cart_id,
        lock_timeout: DO_NOT_WAIT_FOR_LOCK,
      },
    })

    return res.status(200).json({
      payment: result.status === "succeeded"
        ? result
        : { status: result.status, order_id: null },
    })
  } catch (error) {
    if (!isCartLockError(error)) {
      throw error
    }

    return res.status(200).json({
      payment: { status: "pending", order_id: null },
    })
  }
}

export async function getCatalogShippingOptions(
  req: MedusaRequest<{}, GetShippingOptionsQuery>,
  res: MedusaResponse<NormalizedShippingOptionsResult>
) {
  const { cart_id } = req.validatedQuery as GetShippingOptionsQuery
  const result = await listNormalizedShippingOptionsWithErrors(req.scope, cart_id)

  return res.status(200).json(result)
}

export async function getCatalogPickupPoints(
  req: MedusaRequest<{}, GetPickupPointsQuery>,
  res: MedusaResponse<NormalizedPickupPointsResult>
) {
  const { city, provider_key, address } =
    req.validatedQuery as GetPickupPointsQuery
  const catalog = await listNormalizedPickupPointCatalog(
    req.scope,
    city,
    provider_key,
    address
  )

  return res.status(200).json(catalog)
}

export async function syncCatalogShippingAddress(
  req: MedusaRequest<SyncCatalogShippingAddressBody>,
  res: MedusaResponse<{ ok: true }>
) {
  const { cart_id, city, street, house, apartment } = req.validatedBody

  await syncCatalogShippingAddressWorkflow(req.scope).run({
    input: { cart_id, city, street, house, apartment },
  })

  return res.status(200).json({ ok: true })
}

export async function selectCatalogShippingOption(
  req: MedusaRequest<SelectCatalogShippingOptionBody>,
  res: MedusaResponse<{ shipping_option_id: string }>
) {
  const { cart_id, option_id, point_id } = req.validatedBody
  const { result } = await selectCatalogShippingMethodWorkflow(req.scope).run({
    input: { cart_id, option_id, point_id },
  })

  return res.status(200).json(result)
}

export async function getCatalogShippingServices(
  req: MedusaRequest,
  res: MedusaResponse<{ services: NormalizedShippingService[] }>
) {
  const services = await listConnectedShippingServices(req.scope)

  return res.status(200).json({ services })
}

export async function getCatalogShippingTariffs(
  req: MedusaRequest<{}, GetShippingTariffsQuery>,
  res: MedusaResponse<PublicShippingTariffsResult>
) {
  const result = await listPublicShippingTariffs(req.scope, req.validatedQuery)

  return res.status(200).json(result)
}

export async function postCdekWebhook(req: MedusaRequest, res: MedusaResponse) {
  const signature = req.headers[CDEK_WEBHOOK_SIGNATURE_HEADER]
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8")
  const result = await processCdekWebhook(
    req.scope,
    rawBody,
    typeof signature === "string" ? signature : undefined,
    req.body
  )

  return res.status(200).json({ result })
}
