const catalog = {
  listNew: jest.fn(),
  listPromoted: jest.fn(),
  retrieveProduct: jest.fn(),
  validateItems: jest.fn(),
  validateSkus: jest.fn(),
  listBrands: jest.fn(),
  listTree: jest.fn(),
  listCategoryProducts: jest.fn(),
  search: jest.fn(),
}
const shipping = {
  listServices: jest.fn(),
  listOptions: jest.fn(),
  listTariffs: jest.fn(),
  listPoints: jest.fn(),
  selectRun: jest.fn(),
  addressRun: jest.fn(),
}
const content = {
  readSnapshot: jest.fn(),
  emptyHomepage: jest.fn(),
  fetchDraft: jest.fn(),
  filterBanners: jest.fn(),
  verifyPreview: jest.fn(),
  setPreviewHeaders: jest.fn(),
}
const payment = { finalizeRun: jest.fn() }
const cdek = { processWebhook: jest.fn() }

jest.mock("../catalog/utils", () => ({
  listNewCatalogProducts: (...args: unknown[]) => catalog.listNew(...args),
  listPromotedCatalogProducts: (...args: unknown[]) => catalog.listPromoted(...args),
  retrieveCatalogProduct: (...args: unknown[]) => catalog.retrieveProduct(...args),
  validateCatalogCartItems: (...args: unknown[]) => catalog.validateItems(...args),
  validateCatalogCart: (...args: unknown[]) => catalog.validateSkus(...args),
}))
jest.mock("../catalog/brands/utils", () => ({
  listCatalogBrands: (...args: unknown[]) => catalog.listBrands(...args),
}))
jest.mock("../catalog/categories/utils", () => ({
  listCategoryTree: (...args: unknown[]) => catalog.listTree(...args),
}))
jest.mock("../catalog/categories/[handle]/products/utils", () => ({
  listCategoryProducts: (...args: unknown[]) => catalog.listCategoryProducts(...args),
}))
jest.mock("../catalog/search/utils", () => ({
  searchCatalogProducts: (...args: unknown[]) => catalog.search(...args),
}))
jest.mock("../catalog/shipping/utils", () => ({
  listConnectedShippingServices: (...args: unknown[]) => shipping.listServices(...args),
  listNormalizedShippingOptionsWithErrors: (...args: unknown[]) => shipping.listOptions(...args),
  listPublicShippingTariffs: (...args: unknown[]) => shipping.listTariffs(...args),
  listNormalizedPickupPointCatalog: (...args: unknown[]) => shipping.listPoints(...args),
}))
jest.mock("../../workflows/select-catalog-shipping-method", () => ({
  selectCatalogShippingMethodWorkflow: () => ({ run: shipping.selectRun }),
}))
jest.mock("../../workflows/sync-catalog-shipping-address", () => ({
  syncCatalogShippingAddressWorkflow: () => ({ run: shipping.addressRun }),
}))
jest.mock("../../workflows/finalize-catalog-online-payment", () => ({
  finalizeCatalogOnlinePaymentWorkflow: () => ({ run: payment.finalizeRun }),
}))
jest.mock("../../workflows/process-cdek-webhook", () => ({
  CDEK_WEBHOOK_SIGNATURE_HEADER: "x-cdek-signature",
  processCdekWebhook: (...args: unknown[]) => cdek.processWebhook(...args),
}))
jest.mock("../../lib/cms-snapshot", () => ({
  readCmsSnapshot: (...args: unknown[]) => content.readSnapshot(...args),
}))
jest.mock("../../lib/cms-content", () => ({
  createEmptyCmsHomepage: (...args: unknown[]) => content.emptyHomepage(...args),
  fetchDraftHomepage: (...args: unknown[]) => content.fetchDraft(...args),
}))
jest.mock("../../lib/cms-commerce-targets", () => ({
  filterInvalidCmsBanners: (...args: unknown[]) => content.filterBanners(...args),
}))
jest.mock("../../lib/cms-preview", () => ({
  verifyPreviewToken: (...args: unknown[]) => content.verifyPreview(...args),
  setPreviewResponseHeaders: (...args: unknown[]) => content.setPreviewHeaders(...args),
}))

import { MedusaError } from "@medusajs/framework/utils"

import {
  getCatalogBrands as getBrands,
  getCategoryTree,
  getCategoryProducts,
  getNewCatalogProducts as getNewArrivals,
  getPromotedCatalogProducts as getPromotions,
  getCatalogProduct as getProduct,
  getCatalogSearch as searchProducts,
  validateCatalogCartRequest as validateCart,
  getCatalogShippingServices as getShippingServices,
  getCatalogShippingOptions as getShippingOptions,
  getCatalogShippingTariffs as getShippingTariffs,
  getCatalogPickupPoints as getPickupPoints,
  selectCatalogShippingOption as selectShipping,
  syncCatalogShippingAddress as syncAddress,
  getCatalogPaymentStatus as paymentStatus,
  getCatalogHomepage as getHomepage,
  getCatalogHomepagePreview as previewHomepage,
  getSiteContent as siteContentHandler,
  getCatalogCartState as cartStateHandler,
  checkoutCatalogOrder as checkoutHandler,
  getCatalogPaymentProviders as paymentProvidersHandler,
  initiateCatalogPayment as paymentInitiateHandler,
} from "../catalog/handlers"
import { POST as cdekWebhook } from "../catalog/webhooks/cdek/route"
import { GET as storeBrands } from "../store/catalog/brands/route"
import { GET as storeSearch } from "../store/catalog/search/route"
import { GET as storeCategoryTree } from "../store/catalog/categories/tree/route"
import { GET as storeCategoryProducts } from "../store/catalog/categories/[handle]/products/route"
import { GET as storeProduct } from "../store/catalog/products/[id]/route"
import { GET as storePromotions } from "../store/catalog/promotions/route"
import { GET as storeNewArrivals } from "../store/catalog/new-arrivals/route"
import { GET as storeSiteContent } from "../store/catalog/site-content/route"
import { GET as storeHomepage } from "../store/catalog/content/homepage/route"
import { GET as storeHomepagePreview } from "../store/catalog/content/homepage/preview/route"
import { POST as storeValidateCart } from "../store/catalog/cart/validate/route"
import { GET as storeCartState } from "../store/catalog/cart/[id]/state/route"
import { POST as storeCheckout } from "../store/catalog/checkout/route"
import { GET as storePaymentProviders } from "../store/catalog/payment-providers/route"
import { POST as storePaymentInitiate } from "../store/catalog/payment/initiate/route"
import { POST as storePaymentStatus } from "../store/catalog/payment/status/route"
import { GET as storeShippingOptions } from "../store/catalog/shipping/options/route"
import { GET as storeShippingTariffs } from "../store/catalog/shipping/tariffs/route"
import { GET as storePickupPoints } from "../store/catalog/shipping/points/route"
import { POST as storeShippingAddress } from "../store/catalog/shipping/address/route"
import { POST as storeShippingSelect } from "../store/catalog/shipping/select/route"
import { GET as storeShippingServices } from "../store/catalog/shipping/services/route"
import { POST as hookCdekWebhook } from "../hooks/cdek/route"

function response() {
  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
    setHeader: jest.fn(() => res),
  }
  return res
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    scope: { resolve: jest.fn() },
    params: {},
    validatedQuery: {},
    validatedBody: {},
    query: {},
    headers: {},
    body: {},
    ...overrides,
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  catalog.listBrands.mockResolvedValue(["Novol"])
  catalog.listTree.mockResolvedValue([{ id: "cat_1" }])
  catalog.listCategoryProducts.mockResolvedValue({ products: [{ id: "prod_1" }], count: 1 })
  catalog.listNew.mockResolvedValue([{ id: "new_1" }])
  catalog.listPromoted.mockResolvedValue([{ id: "promo_1" }])
  catalog.retrieveProduct.mockResolvedValue({ id: "prod_1" })
  catalog.search.mockResolvedValue({ products: [{ id: "prod_1" }], count: 1 })
  catalog.validateItems.mockResolvedValue([{ variant_id: "variant_1", purchasable: true }])
  catalog.validateSkus.mockResolvedValue([{ sku: "SKU-1", purchasable: true }])
  shipping.listServices.mockResolvedValue([{ provider: "cdek" }])
  shipping.listOptions.mockResolvedValue({ shipping_options: [{ id: "so_1" }] })
  shipping.listTariffs.mockResolvedValue({
    city: "Москва",
    tariffs: [{ provider_key: "cdek_cdek", tariff_code: 137 }],
    unavailable_providers: [],
  })
  shipping.listPoints.mockResolvedValue({
    points: [{ id: "point_1" }],
    map_points: [{ id: "point_1" }],
    sources: [{ provider_key: "cdek_cdek", status: "available" }],
  })
  shipping.selectRun.mockResolvedValue({ result: { selected: true } })
  shipping.addressRun.mockResolvedValue({ result: { ok: true } })
  payment.finalizeRun.mockResolvedValue({ result: { status: "succeeded", order_id: "order_1" } })
  content.readSnapshot.mockResolvedValue({ revision: "rev_1", sections: [], settings: {} })
  content.emptyHomepage.mockReturnValue({ revision: "empty", sections: [], settings: {} })
  content.fetchDraft.mockResolvedValue({ revision: "draft", sections: [], settings: {} })
  content.filterBanners.mockImplementation(async (_scope, value) => value)
  content.verifyPreview.mockReturnValue(true)
  cdek.processWebhook.mockResolvedValue({ status: "applied" })
})

it("wires every store address to its catalog handler", () => {
  const routes: Array<[Function, Function]> = [
    [storeBrands, getBrands],
    [storeSearch, searchProducts],
    [storeCategoryTree, getCategoryTree],
    [storeCategoryProducts, getCategoryProducts],
    [storeProduct, getProduct],
    [storePromotions, getPromotions],
    [storeNewArrivals, getNewArrivals],
    [storeSiteContent, siteContentHandler],
    [storeHomepage, getHomepage],
    [storeHomepagePreview, previewHomepage],
    [storeValidateCart, validateCart],
    [storeCartState, cartStateHandler],
    [storeCheckout, checkoutHandler],
    [storePaymentProviders, paymentProvidersHandler],
    [storePaymentInitiate, paymentInitiateHandler],
    [storePaymentStatus, paymentStatus],
    [storeShippingOptions, getShippingOptions],
    [storeShippingTariffs, getShippingTariffs],
    [storePickupPoints, getPickupPoints],
    [storeShippingAddress, syncAddress],
    [storeShippingSelect, selectShipping],
    [storeShippingServices, getShippingServices],
    [hookCdekWebhook, cdekWebhook],
  ]

  for (const [storeHandler, handler] of routes) {
    expect(storeHandler).toBe(handler)
  }
})

it("lists payment providers for the storefront store and its default region", async () => {
  const graph = jest.fn().mockResolvedValue({
    data: [{ id: "store-1", default_region_id: "region-1" }],
  })
  const listStorePaymentProviders = jest
    .fn()
    .mockResolvedValue([{ id: "yookassa", name: "ЮKassa" }])
  const req = request({
    scope: {
      resolve: jest.fn((key: string) =>
        key === "query" ? { graph } : { listStorePaymentProviders }
      ),
    },
  })
  const res = response()

  await paymentProvidersHandler(req, res)

  expect(listStorePaymentProviders).toHaveBeenCalledWith({
    store_id: "store-1",
    region_id: "region-1",
  })
  expect(res.json).toHaveBeenCalledWith({
    payment_providers: [{ id: "yookassa", name: "ЮKassa" }],
  })
})

it("returns no payment providers when the store has no default region", async () => {
  const listStorePaymentProviders = jest.fn()
  const req = request({
    scope: {
      resolve: jest.fn((key: string) =>
        key === "query"
          ? { graph: jest.fn().mockResolvedValue({ data: [{ id: "store-1" }] }) }
          : { listStorePaymentProviders }
      ),
    },
  })
  const res = response()

  await paymentProvidersHandler(req, res)

  expect(listStorePaymentProviders).not.toHaveBeenCalled()
  expect(res.json).toHaveBeenCalledWith({ payment_providers: [] })
})

it("serves catalog lists/details with stable envelopes and cache headers", async () => {
  const cases: Array<[Function, any, unknown]> = [
    [getBrands, request(), { brands: ["Novol"] }],
    [getCategoryTree, request(), { categories: [{ id: "cat_1" }] }],
    [getCategoryProducts, request({ params: { handle: "paint" }, validatedQuery: { page: 2, subcategory: "primer" } }), { products: [{ id: "prod_1" }], count: 1 }],
    [getNewArrivals, request(), { products: [{ id: "new_1" }] }],
    [getPromotions, request(), { products: [{ id: "promo_1" }] }],
    [getProduct, request({ params: { id: "prod_1" } }), { product: { id: "prod_1" } }],
    [searchProducts, request({ validatedQuery: { q: "red", sort: "price_asc" } }), { products: [{ id: "prod_1" }], count: 1 }],
  ]
  for (const [handler, req, body] of cases) {
    const res = response()
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(body)
  }
  expect(catalog.listCategoryProducts).toHaveBeenCalledWith(
    expect.anything(), "paint", 2, "primer",
  )
  expect(catalog.search).toHaveBeenCalledWith(expect.anything(), { q: "red", sort: "price_asc" })

  const brandsRes = response()
  await getBrands(request(), brandsRes)
  expect(brandsRes.setHeader).toHaveBeenCalledWith(
    "Cache-Control", "public, max-age=60, stale-while-revalidate=300",
  )
})

it("returns 404 when a product disappeared from the source-of-truth read path", async () => {
  catalog.retrieveProduct.mockResolvedValue(null)
  await expect(getProduct(request({ params: { id: "missing" } }), response()))
    .rejects.toBeInstanceOf(MedusaError)
})

it("selects item-aware or legacy cart validation from the request contract", async () => {
  const itemReq = request({ validatedBody: { items: [{ variant_id: "variant_1", quantity: 2 }], skus: ["ignored"] } })
  const itemRes = response()
  await validateCart(itemReq, itemRes)
  expect(catalog.validateItems).toHaveBeenCalledWith(itemReq.scope, itemReq.validatedBody.items)
  expect(catalog.validateSkus).not.toHaveBeenCalled()

  const skuReq = request({ validatedBody: { items: [], skus: ["SKU-1"] } })
  await validateCart(skuReq, response())
  expect(catalog.validateSkus).toHaveBeenCalledWith(skuReq.scope, ["SKU-1"])

  const emptyReq = request({ validatedBody: {} })
  await validateCart(emptyReq, response())
  expect(catalog.validateSkus).toHaveBeenLastCalledWith(emptyReq.scope, [])
})

it("passes normalized shipping queries and mutations to their owner layer", async () => {
  const services = response()
  await getShippingServices(request(), services)
  expect(services.json).toHaveBeenCalledWith({ services: [{ provider: "cdek" }] })

  const optionsReq = request({ validatedQuery: { cart_id: "cart_1" } })
  await getShippingOptions(optionsReq, response())
  expect(shipping.listOptions).toHaveBeenCalledWith(optionsReq.scope, "cart_1")

  const tariffsReq = request({ validatedQuery: { city: "Москва", postal_code: "101000" } })
  const tariffsRes = response()
  await getShippingTariffs(tariffsReq, tariffsRes)
  expect(shipping.listTariffs).toHaveBeenCalledWith(tariffsReq.scope, {
    city: "Москва", postal_code: "101000",
  })
  expect(tariffsRes.json).toHaveBeenCalledWith({
    city: "Москва",
    tariffs: [{ provider_key: "cdek_cdek", tariff_code: 137 }],
    unavailable_providers: [],
  })

  const pointsReq = request({ validatedQuery: { city: "Москва", provider_key: "cdek", address: "Ленина" } })
  const pointsRes = response()
  await getPickupPoints(pointsReq, pointsRes)
  expect(shipping.listPoints).toHaveBeenCalledWith(pointsReq.scope, "Москва", "cdek", "Ленина")
  expect(pointsRes.json).toHaveBeenCalledWith({
    points: [{ id: "point_1" }],
    map_points: [{ id: "point_1" }],
    sources: [{ provider_key: "cdek_cdek", status: "available" }],
  })

  const selectReq = request({ validatedBody: { cart_id: "cart_1", option_id: "so_1", point_id: "point_1" } })
  const selectRes = response()
  await selectShipping(selectReq, selectRes)
  expect(shipping.selectRun).toHaveBeenCalledWith({ input: selectReq.validatedBody })
  expect(selectRes.json).toHaveBeenCalledWith({ selected: true })

  const addressReq = request({ validatedBody: { cart_id: "cart_1", city: "Москва" } })
  const addressRes = response()
  await syncAddress(addressReq, addressRes)
  expect(shipping.addressRun).toHaveBeenCalledWith({ input: addressReq.validatedBody })
  expect(addressRes.json).toHaveBeenCalledWith({ ok: true })
})

it("finalizes a payment status request through the stored workflow", async () => {
  const req = request({ validatedBody: { cart_id: "cart_1", payment_session_id: "payses_1" } })
  const res = response()
  await paymentStatus(req, res)
  // lock_timeout: 0 — опрос не встаёт в очередь за локом на корзину.
  expect(payment.finalizeRun).toHaveBeenCalledWith({
    input: { cart_id: "cart_1", lock_timeout: 0 },
  })
  expect(res.json).toHaveBeenCalledWith({ payment: { status: "succeeded", order_id: "order_1" } })
})

it("reports pending instead of failing when the cart is already being processed", async () => {
  payment.finalizeRun.mockRejectedValueOnce(
    new Error('Failed to acquire lock for key "cart_1"')
  )

  const req = request({ validatedBody: { cart_id: "cart_1" } })
  const res = response()
  await paymentStatus(req, res)

  expect(res.status).toHaveBeenCalledWith(200)
  expect(res.json).toHaveBeenCalledWith({
    payment: { status: "pending", order_id: null },
  })
})

it("does not swallow unrelated payment failures", async () => {
  payment.finalizeRun.mockRejectedValueOnce(new Error("YooKassa unreachable"))

  const req = request({ validatedBody: { cart_id: "cart_1" } })

  await expect(paymentStatus(req, response())).rejects.toThrow("YooKassa unreachable")
})

it("serves snapshot/fallback homepage content and authorizes previews", async () => {
  const snapshotRes = response()
  await getHomepage(request(), snapshotRes)
  expect(snapshotRes.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  expect(snapshotRes.json).toHaveBeenCalledWith(expect.objectContaining({ revision: "rev_1" }))

  content.readSnapshot.mockResolvedValueOnce(null)
  await getHomepage(request(), response())
  expect(content.emptyHomepage).toHaveBeenCalledWith(process.env.STOREFRONT_COMPANY_NAME)

  process.env.CMS_PREVIEW_SIGNING_SECRET = "preview-secret"
  const previewReq = request({ query: { token: "valid" } })
  const previewRes = response()
  await previewHomepage(previewReq, previewRes)
  expect(content.verifyPreview).toHaveBeenCalledWith("valid", "preview-secret")
  expect(content.setPreviewHeaders).toHaveBeenCalledWith(previewRes)
  expect(previewRes.json).toHaveBeenCalledWith(expect.objectContaining({ revision: "draft", preview: true }))

  content.verifyPreview.mockReturnValue(false)
  await expect(previewHomepage(request({ query: { token: ["bad"] } }), response()))
    .rejects.toBeInstanceOf(MedusaError)
  delete process.env.CMS_PREVIEW_SIGNING_SECRET
  await expect(previewHomepage(request({ query: { token: "valid" } }), response()))
    .rejects.toBeInstanceOf(MedusaError)
})

it("preserves raw CDEK webhook bytes and normalizes a non-string signature", async () => {
  const raw = Buffer.from("raw-cdek")
  const req = request({
    rawBody: raw,
    body: { uuid: "event_1" },
    headers: { "x-cdek-signature": "signature" },
  })
  await cdekWebhook(req, response())
  expect(cdek.processWebhook).toHaveBeenCalledWith(req.scope, raw, "signature", req.body)

  const fallback = request({ body: { uuid: "event_2" }, headers: { "x-cdek-signature": ["bad"] } })
  await cdekWebhook(fallback, response())
  expect(cdek.processWebhook).toHaveBeenLastCalledWith(
    fallback.scope,
    Buffer.from(JSON.stringify(fallback.body), "utf8"),
    undefined,
    fallback.body,
  )
})
