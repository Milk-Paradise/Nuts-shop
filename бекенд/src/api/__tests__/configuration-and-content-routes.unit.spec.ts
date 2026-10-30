const visibilityRun = jest.fn()

jest.mock("../../workflows/set-shipping-provider-visibility", () => ({
  __esModule: true,
  default: () => ({ run: visibilityRun }),
}))
jest.mock("../../lib/cms-preview", () => ({
  createPreviewToken: jest.fn(() => "signed-token"),
}))
const cms = { verify: jest.fn(), refresh: jest.fn(), resolveTargets: jest.fn() }
jest.mock("../../lib/cms-snapshot", () => ({
  CMS_HOMEPAGE_SNAPSHOT_KEY: "homepage",
  CMS_NOTIFICATION_TEMPLATES_SNAPSHOT_KEY: "notification-templates",
  verifyCmsWebhook: (...args: unknown[]) => cms.verify(...args),
  refreshCmsSnapshot: (...args: unknown[]) => cms.refresh(...args),
}))
jest.mock("../../lib/cms-commerce-targets", () => ({
  resolveValidCommerceTargets: (...args: unknown[]) => cms.resolveTargets(...args),
}))

import { MedusaError } from "@medusajs/framework/utils"
import { GET as listShippingProviders, POST as setShippingProvider } from "../admin/shipping-providers/route"
import { requirePaymentProviderConfigReadPermission } from "../admin/payment-providers/authorization"
import { POST as savePaymentProvider } from "../admin/payment-providers/[provider_id]/route"
import { GET as getCatalogConfig } from "../catalog/config/route"
import { listCatalogBrands } from "../catalog/brands/utils"
import { getSiteContent as getSiteContent } from "../catalog/handlers"
import { GET as getAdminSiteContent } from "../admin/site-content/route"
import { POST as createPreviewLink } from "../cms/preview-link/route"
import { POST as receiveCmsWebhook } from "../cms/webhook/route"
import { POST as validateCmsTargets } from "../cms/targets/validate/route"

function response() {
  const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) }
  return res
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    scope: { resolve: jest.fn() }, params: {}, validatedBody: {}, headers: {}, body: {},
    auth_context: { actor_id: "user_1", app_metadata: {} }, ...overrides,
  } as any
}

describe("configuration and content API boundaries", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.CMS_PREVIEW_INTERNAL_SECRET
    delete process.env.CMS_PREVIEW_SIGNING_SECRET
    delete process.env.STOREFRONT_PUBLIC_URL
    delete process.env.STRAPI_WEBHOOK_SECRET
  })

  it("reports registered, configured, and visible supported shipping providers", async () => {
    const query = { graph: jest.fn().mockResolvedValue({ data: [
      { id: "manual_manual", is_enabled: true },
      { id: "cdek_cdek", is_enabled: false },
    ] }) }
    const registry = {
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([]),
      getProviderConfig: jest.fn().mockResolvedValue(null),
    }
    const req = request({ scope: { resolve: jest.fn((key) =>
      typeof key === "string" && key.includes("shipping") ? registry : query) } })
    const res = response()

    await listShippingProviders(req, res)
    expect(res.json).toHaveBeenCalledWith({ shipping_providers: [
      expect.objectContaining({ provider_key: "cdek_cdek", is_visible: false, registered: false, configured: false, settings_path: null }),
      expect.objectContaining({ provider_key: "ozon_ozon", is_visible: false, registered: false, configured: false, settings_path: null }),
    ] })
  })

  it("rejects unsupported visibility updates for unknown providers", async () => {
    await expect(setShippingProvider(request({ validatedBody: { provider_key: "future_provider", is_visible: true } }), response()))
      .rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
    expect(visibilityRun).not.toHaveBeenCalled()
  })

  it("accepts visibility updates for ozon_ozon", async () => {
    visibilityRun.mockResolvedValue({ result: { provider_key: "ozon_ozon", is_visible: true } })
    await setShippingProvider(request({ validatedBody: { provider_key: "ozon_ozon", is_visible: true } }), response())
    expect(visibilityRun).toHaveBeenCalledWith({ input: { provider_key: "ozon_ozon", is_visible: true } })
  })

  it("allows payment config reads when RBAC is off or the actor is a super admin", async () => {
    const next = jest.fn()
    const flag = { isFeatureEnabled: jest.fn().mockReturnValue(false) }
    await requirePaymentProviderConfigReadPermission(request({ scope: { resolve: jest.fn(() => flag) } }), {} as any, next)
    expect(next).toHaveBeenCalledWith()

    next.mockClear(); flag.isFeatureEnabled.mockReturnValue(true)
    await requirePaymentProviderConfigReadPermission(request({
      scope: { resolve: jest.fn(() => flag) },
      auth_context: { app_metadata: { roles: [null, "role_super_admin"] } },
    }), {} as any, next)
    expect(next).toHaveBeenCalledWith()
  })

  it("denies payment config reads without a qualifying role and forwards resolver errors", async () => {
    const next = jest.fn()
    const flag = { isFeatureEnabled: jest.fn().mockReturnValue(true) }
    await requirePaymentProviderConfigReadPermission(request({
      scope: { resolve: jest.fn(() => flag) }, auth_context: { app_metadata: { roles: "invalid" } },
    }), {} as any, next)
    expect(next.mock.calls[0][0]).toBeInstanceOf(MedusaError)

    next.mockClear()
    const failure = new Error("container unavailable")
    await requirePaymentProviderConfigReadPermission(request({ scope: { resolve: jest.fn(() => { throw failure }) } }), {} as any, next)
    expect(next).toHaveBeenCalledWith(failure)
  })

  it("validates initial payment credentials and preserves optional fields on updates", async () => {
    const service = {
      retrieveAdminPaymentProviderConfig: jest.fn().mockResolvedValueOnce(null),
      savePaymentProviderConfig: jest.fn(),
    }
    const scope = { resolve: jest.fn(() => service) }
    await expect(savePaymentProvider(request({
      params: { provider_id: "unknown" }, scope,
      validatedBody: { shop_id: "shop", secret_key: "secret", mode: "test" },
    }), response())).rejects.toBeInstanceOf(MedusaError)

    await expect(savePaymentProvider(request({
      params: { provider_id: "yookassa" }, scope,
      validatedBody: { shop_id: " ", secret_key: undefined, mode: "test" },
    }), response())).rejects.toBeInstanceOf(MedusaError)

    service.retrieveAdminPaymentProviderConfig
      .mockResolvedValueOnce({ id: "config_1" })
      .mockResolvedValueOnce({ id: "config_1", secret_key_set: true })
    const res = response()
    await savePaymentProvider(request({
      params: { provider_id: "yookassa" }, scope,
      validatedBody: { shop_id: undefined, secret_key: undefined, mode: "live" },
    }), res)
    expect(service.savePaymentProviderConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider_id: "yookassa", mode: "live", actor_id: "user_1",
    }))
    expect(res.json).toHaveBeenCalledWith({ payment_provider: { id: "config_1", secret_key_set: true } })
  })

  it("selects the active publishable key linked to the default sales channel", async () => {
    const graph = jest.fn()
      .mockResolvedValueOnce({ data: [{ default_sales_channel_id: "sc_1" }] })
      .mockResolvedValueOnce({ data: [
        { token: "revoked", revoked_at: new Date(), sales_channels: [{ id: "sc_1" }] },
        { token: "wrong", revoked_at: null, sales_channels: [{ id: "sc_2" }] },
        { token: "active", revoked_at: null, sales_channels: [null, { id: "sc_1" }] },
      ] })
    const res = response()
    await getCatalogConfig(request({ scope: { resolve: jest.fn(() => ({ graph })) } }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ publishable_api_key: "active" })
  })

  it("rejects catalog config without a default channel or linked active key", async () => {
    for (const graph of [
      jest.fn().mockResolvedValue({ data: [] }),
      jest.fn().mockResolvedValueOnce({ data: [{ default_sales_channel_id: "sc_1" }] }).mockResolvedValueOnce({ data: [] }),
    ]) {
      await expect(getCatalogConfig(request({ scope: { resolve: jest.fn(() => ({ graph })) } }), response()))
        .rejects.toBeInstanceOf(MedusaError)
    }
  })

  it("normalizes and sorts distinct published product brands", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [
      { metadata: { brand: " Zeta " } }, { metadata: { brand: "Альфа" } },
      { metadata: { brand: "Zeta" } }, { metadata: { brand: " " } },
      { metadata: { brand: 42 } }, {},
    ] })
    await expect(listCatalogBrands({ resolve: jest.fn(() => ({ graph })) } as any))
      .resolves.toEqual(["Альфа", "Zeta"])
  })

  it("returns storefront placeholders and admin nulls for absent tabs", async () => {
    const service = {
      listSiteTabs: jest.fn().mockResolvedValue([{ key: "delivery", content: "Delivery" }]),
      listSiteLinks: jest.fn().mockResolvedValue([
        { kind: "social", label: "VK", url: "https://vk.example" },
        { kind: "reviews", label: "Reviews", url: "https://reviews.example" },
        { kind: "other", label: "Other", url: "https://other.example" },
      ]),
    }
    const req = request({ scope: { resolve: jest.fn(() => service) } })
    const publicRes = response(); await getSiteContent(req, publicRes)
    expect(publicRes.json).toHaveBeenCalledWith(expect.objectContaining({
      social_links: [{ label: "VK", url: "https://vk.example" }],
      reviews_url: "https://reviews.example",
      tabs: expect.arrayContaining([{ key: "delivery", content: "Delivery" }]),
    }))
    const adminRes = response(); await getAdminSiteContent(req, adminRes)
    expect(adminRes.json).toHaveBeenCalledWith(expect.objectContaining({ links: expect.any(Array) }))

    service.listSiteLinks.mockResolvedValue([])
    const noReviews = response(); await getSiteContent(req, noReviews)
    expect(noReviews.json).toHaveBeenCalledWith(expect.objectContaining({ reviews_url: null }))
  })

  it("authenticates preview links and checks all required configuration", async () => {
    const req = request({ headers: { "x-cms-internal-secret": "internal" } })
    await expect(createPreviewLink(req, response())).rejects.toBeInstanceOf(MedusaError)
    process.env.CMS_PREVIEW_INTERNAL_SECRET = "internal"
    await expect(createPreviewLink(req, response())).rejects.toThrow("CMS_PREVIEW_SIGNING_SECRET")
    process.env.CMS_PREVIEW_SIGNING_SECRET = "signing"
    await expect(createPreviewLink(req, response())).rejects.toThrow("STOREFRONT_PUBLIC_URL")
    process.env.STOREFRONT_PUBLIC_URL = "https://store.example/base"
    const res = response(); await createPreviewLink(req, res)
    expect(res.json).toHaveBeenCalledWith({ url: "https://store.example/preview?token=signed-token", expires_in: 600 })
  })

  it("verifies CMS webhook signatures before refreshing the snapshot", async () => {
    const req = request({ headers: { "x-cms-timestamp": "123", "x-cms-signature": "sig" }, body: undefined })
    await expect(receiveCmsWebhook(req, response())).rejects.toBeInstanceOf(MedusaError)
    process.env.STRAPI_WEBHOOK_SECRET = "secret"
    cms.verify.mockReturnValue(false)
    await expect(receiveCmsWebhook(req, response())).rejects.toBeInstanceOf(MedusaError)
    cms.verify.mockReturnValue(true); cms.refresh.mockResolvedValue({ revision: "rev_2" })
    const res = response(); await receiveCmsWebhook(req, res)
    expect(cms.verify).toHaveBeenCalledWith("{}", "123", "sig", "secret")
    expect(cms.refresh).toHaveBeenCalledTimes(2)
    expect(res.json).toHaveBeenCalledWith({
      revision: "rev_2",
      revisions: { homepage: "rev_2", "notification-templates": "rev_2" },
    })
  })

  it("validates only array CMS targets after authenticating the caller", async () => {
    process.env.STRAPI_WEBHOOK_SECRET = "secret"
    cms.resolveTargets.mockResolvedValue(new Set(["product:1"]))
    // Роут читает req.validatedBody, а цели — объекты {type, medusaId},
    // а не голые идентификаторы: схема CmsTargetsValidateSchema и комментарий
    // рядом с ней прямо об этом говорят.
    const targets = [{ type: "product", medusaId: "prod_1" }]
    const req = request({
      headers: { "x-cms-internal-secret": "secret" },
      validatedBody: { targets },
    })
    const res = response(); await validateCmsTargets(req, res)
    expect(cms.resolveTargets).toHaveBeenCalledWith(req.scope, targets)
    expect(res.json).toHaveBeenCalledWith({ valid: ["product:1"] })

    await validateCmsTargets(
      request({ headers: { "x-cms-internal-secret": "secret" }, validatedBody: { targets: [] } }),
      response(),
    )
    expect(cms.resolveTargets).toHaveBeenLastCalledWith(expect.anything(), [])
    await expect(validateCmsTargets(request(), response())).rejects.toBeInstanceOf(MedusaError)
  })
})
