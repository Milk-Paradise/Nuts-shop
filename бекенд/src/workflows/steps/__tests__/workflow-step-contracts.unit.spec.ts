const runCreateShippingOptions = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => ({
  createShippingOptionsWorkflow: () => ({ run: runCreateShippingOptions }),
}))

jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: string, invoke: any, compensate?: any) =>
    Object.assign(invoke, { compensate }),
  StepResponse: class StepResponse<T, C> {
    constructor(readonly result: T, readonly compensation?: C) {}
  },
}))

import { ensureCdekShippingOptionsStep } from "../ensure-cdek-shipping-options"
import {
  createShippingReturnRequestStep,
  deleteShippingReturnRequestStep,
  saveShippingProviderConfigStep,
  saveShippingStorePackageStep,
  updateShippingReturnRequestStep,
} from "../shipping-provider-registry"
import { transferCatalogCartReservationsStep } from "../transfer-catalog-cart-reservations"
import { setPaymentProviderEnabledStep } from "../set-payment-provider-enabled"
import { saveSiteLinkStep } from "../save-site-link"
import { upsertSiteTabStep } from "../upsert-site-tab"
import { deleteSiteLinkStep } from "../delete-site-link"
import {
  hasVerifiedCdekConfiguration,
  setShippingProviderVisibilityStep,
} from "../set-shipping-provider-visibility"
import { encryptShippingProviderCredentials } from "../../../modules/shipping-provider-registry/credentials"

function container(resolver: (key: string) => unknown) {
  return { resolve: jest.fn(resolver) } as any
}

describe("shipping provider registry workflow steps", () => {
  const invoke = async (step: any, service: any, input: unknown) =>
    step(input, { container: container(() => service) })
  const compensate = async (step: any, service: any, state: unknown) =>
    step.compensate(state, { container: container(() => service) })

  it("creates and rolls back new provider configuration", async () => {
    const service = {
      getProviderConfig: jest.fn().mockResolvedValue(null),
      saveProviderConfig: jest.fn().mockResolvedValue({ id: "config-1" }),
      deleteShippingProviderConfigs: jest.fn(),
    }
    const response = await invoke(saveShippingProviderConfigStep, service, { providerKey: "cdek" })
    expect(response.compensation).toEqual({ previous: null, createdId: "config-1" })
    await compensate(saveShippingProviderConfigStep, service, response.compensation)
    expect(service.deleteShippingProviderConfigs).toHaveBeenCalledWith("config-1")
    await compensate(saveShippingProviderConfigStep, service, undefined)
  })

  it("restores previous provider config and package on rollback", async () => {
    const service = {
      getProviderConfig: jest.fn().mockResolvedValue({ id: "config-1", old: true }),
      saveProviderConfig: jest.fn().mockResolvedValue({ id: "config-1" }),
      updateShippingProviderConfigs: jest.fn(),
      getStorePackage: jest.fn().mockResolvedValue({ id: "package-1", length: 1 }),
      saveStorePackage: jest.fn().mockResolvedValue({ id: "package-1" }),
      updateShippingStorePackages: jest.fn(),
    }
    const config = await invoke(saveShippingProviderConfigStep, service, { providerKey: "cdek" })
    await compensate(saveShippingProviderConfigStep, service, config.compensation)
    expect(service.updateShippingProviderConfigs).toHaveBeenCalledWith({ id: "config-1", old: true })
    const pkg = await invoke(saveShippingStorePackageStep, service, { length: 2 })
    await compensate(saveShippingStorePackageStep, service, pkg.compensation)
    expect(service.updateShippingStorePackages).toHaveBeenCalledWith({ id: "package-1", length: 1 })
  })

  it("deletes a newly created package during compensation", async () => {
    const service = {
      getStorePackage: jest.fn().mockResolvedValue(null),
      saveStorePackage: jest.fn().mockResolvedValue({ id: "package-1" }),
      deleteShippingStorePackages: jest.fn(),
    }
    const response = await invoke(saveShippingStorePackageStep, service, {})
    await compensate(saveShippingStorePackageStep, service, response.compensation)
    expect(service.deleteShippingStorePackages).toHaveBeenCalledWith("package-1")
  })

  it("creates, updates, deletes and compensates return requests", async () => {
    const previous = { id: "return-1", status: "pending" }
    const service = {
      createShippingReturnRequests: jest.fn().mockResolvedValue(previous),
      retrieveShippingReturnRequest: jest.fn().mockResolvedValue(previous),
      updateShippingReturnRequests: jest.fn().mockResolvedValue({ ...previous, status: "approved" }),
      deleteShippingReturnRequests: jest.fn(),
    }
    const created = await invoke(createShippingReturnRequestStep, service, { order_id: "order-1" })
    await compensate(createShippingReturnRequestStep, service, created.compensation)
    expect(service.deleteShippingReturnRequests).toHaveBeenCalledWith("return-1")
    const updated = await invoke(updateShippingReturnRequestStep, service, { id: "return-1", status: "approved" })
    await compensate(updateShippingReturnRequestStep, service, updated.compensation)
    expect(service.updateShippingReturnRequests).toHaveBeenLastCalledWith(previous)
    const deleted = await invoke(deleteShippingReturnRequestStep, service, "return-1")
    await compensate(deleteShippingReturnRequestStep, service, deleted.compensation)
    expect(service.createShippingReturnRequests).toHaveBeenLastCalledWith(previous)
    await compensate(deleteShippingReturnRequestStep, service, undefined)
  })
})

describe("CDEK option lifecycle", () => {
  const invoke = ensureCdekShippingOptionsStep as any

  function setup(stored: any[], existing: any[]) {
    const fulfillment = {
      listShippingOptions: jest.fn().mockResolvedValue(stored),
      deleteShippingOptions: jest.fn(),
      restoreShippingOptions: jest.fn(),
    }
    const query = { graph: jest.fn().mockResolvedValue({ data: existing }) }
    return { fulfillment, container: container((key) => key === "query" ? query : fulfillment) }
  }

  it("disables active CDEK options and restores them on rollback", async () => {
    const { fulfillment, container: scope } = setup([{ id: "active", deleted_at: null }, { id: "deleted", deleted_at: new Date() }], [])
    const response = await invoke({ enabled: false }, { container: scope })
    expect(response.result).toEqual({ created: 0, restored: 0, disabled: 1 })
    await invoke.compensate(response.compensation, { container: scope })
    expect(fulfillment.restoreShippingOptions).toHaveBeenCalledWith(["active"])
  })

  it("restores deleted options and creates only missing zone/profile/type pairs", async () => {
    runCreateShippingOptions.mockResolvedValue({ result: [{ id: "new-pickup" }] })
    const existing = [
      { id: "manual", provider_id: "manual", service_zone_id: "zone", shipping_profile_id: "profile", data: {} },
      { id: "courier", provider_id: "cdek_cdek", service_zone_id: "zone", shipping_profile_id: "profile", data: { delivery_type: "courier" } },
      { id: "invalid", provider_id: "manual", service_zone_id: null, shipping_profile_id: "profile" },
    ]
    const { fulfillment, container: scope } = setup([{ id: "deleted", deleted_at: new Date() }], existing)
    const response = await invoke({ enabled: true }, { container: scope })
    expect(response.result).toEqual({ created: 1, restored: 1, disabled: 0 })
    expect(runCreateShippingOptions.mock.calls[0][0].input).toEqual([
      expect.objectContaining({ data: { delivery_type: "pickup" }, name: "СДЭК: пункт выдачи" }),
    ])
    await invoke.compensate(response.compensation, { container: scope })
    expect(fulfillment.deleteShippingOptions).toHaveBeenCalledWith(["new-pickup"])
    expect(fulfillment.deleteShippingOptions).toHaveBeenCalledWith(["deleted"])
  })

  it("does not create duplicate complete pairs", async () => {
    const pair = (type: string) => ({ provider_id: "cdek_cdek", service_zone_id: "zone", shipping_profile_id: "profile", data: { delivery_type: type } })
    const { container: scope } = setup([], [pair("courier"), pair("pickup")])
    const response = await invoke({ enabled: true }, { container: scope })
    expect(response.result.created).toBe(0)
  })
})

describe("shipping-provider visibility lifecycle", () => {
  const invoke = setShippingProviderVisibilityStep as any

  it("creates a disabled CDEK visibility record and removes it on rollback", async () => {
    const service = {
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([]),
      createShippingProviderVisibilities: jest.fn().mockResolvedValue({ id: "visible-1" }),
      deleteShippingProviderVisibilities: jest.fn(),
    }
    const scope = container(() => service)
    const response = await invoke(
      { provider_key: "cdek_cdek", is_visible: false },
      { container: scope },
    )
    expect(response.compensation).toEqual({
      id: "visible-1",
      existed: false,
      previous_is_visible: null,
    })
    await invoke.compensate(response.compensation, { container: scope })
    expect(service.deleteShippingProviderVisibilities).toHaveBeenCalledWith("visible-1")
    await invoke.compensate(undefined, { container: scope })
  })

  it("updates an existing record and restores its previous state", async () => {
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "visibility-contract-test-key"
    const service = {
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([
        { id: "visible-1", is_visible: false },
      ]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({ client_id: "client", client_secret: "secret" }),
        configuration: {
          sender: { city: "Тула", street: "Ленина, 1", postal_code: "300000", contact_name: "Иван", phone: "+70000000000" },
          contract_type: "delivery",
          tariff_codes: [136],
        },
      }),
      updateShippingProviderVisibilities: jest.fn().mockResolvedValue({ id: "visible-1" }),
    }
    const scope = container(() => service)
    const response = await invoke(
      { provider_key: "cdek_cdek", is_visible: true },
      { container: scope },
    )
    await invoke.compensate(response.compensation, { container: scope })
    expect(service.updateShippingProviderVisibilities).toHaveBeenNthCalledWith(1, {
      id: "visible-1", is_visible: true,
    })
    expect(service.updateShippingProviderVisibilities).toHaveBeenNthCalledWith(2, {
      id: "visible-1", is_visible: false,
    })
  })

  it.each([
    null,
    {},
    { encrypted_credentials: "encrypted" },
    { encrypted_credentials: "encrypted", configuration: "bad" },
    { encrypted_credentials: "encrypted", configuration: {} },
    { encrypted_credentials: "encrypted", configuration: { tariff_codes: "136" } },
    { encrypted_credentials: "encrypted", configuration: { tariff_codes: [] } },
  ])("rejects enabling CDEK with incomplete configuration %#", async (config) => {
    expect(hasVerifiedCdekConfiguration(config as any)).toBe(false)
    const service = {
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([]),
      getProviderConfig: jest.fn().mockResolvedValue(config),
    }
    await expect(invoke(
      { provider_key: "cdek_cdek", is_visible: true },
      { container: container(() => service) },
    )).rejects.toThrow("настройте")
  })

  it("allows hiding CDEK without requiring credentials", async () => {
    const service = {
      listShippingProviderVisibilities: jest.fn().mockResolvedValue([]),
      getProviderConfig: jest.fn(),
      createShippingProviderVisibilities: jest.fn().mockResolvedValue({ id: "visible-1" }),
    }
    await invoke(
      { provider_key: "cdek_cdek", is_visible: false },
      { container: container(() => service) },
    )
    expect(service.getProviderConfig).not.toHaveBeenCalled()
  })
})

describe("reservation ownership transfer", () => {
  const invoke = transferCatalogCartReservationsStep as any

  function setup(reservations: any[]) {
    const inventory = {
      listReservationItems: jest.fn().mockResolvedValue(reservations),
      updateReservationItems: jest.fn(async (updates) => updates),
    }
    const locking = { execute: jest.fn(async (_ids, callback) => callback()) }
    return { inventory, locking, container: container((key) => String(key).includes("inventory") ? inventory : locking) }
  }

  it("short-circuits empty expectations", async () => {
    const { container: scope } = setup([])
    const response = await invoke({ expected: [], order_items: [] }, { container: scope })
    expect(response.result).toEqual([])
  })

  it("atomically moves matching reservations and restores ownership on rollback", async () => {
    const reservations = [
      { id: "res-1", line_item_id: "cart-line", inventory_item_id: "inv", quantity: 1 },
      { id: "res-2", line_item_id: "cart-line", inventory_item_id: "inv", quantity: 1 },
    ]
    const { inventory, container: scope } = setup(reservations)
    const response = await invoke({
      expected: [{ cart_line_id: "cart-line", inventory_item_id: "inv", quantity: 2 }],
      order_items: [{ id: "order-line", metadata: { catalog_cart_line_id: "cart-line" } }, { id: "ignored", metadata: {} }],
    }, { container: scope })
    expect(inventory.updateReservationItems).toHaveBeenCalledWith([
      { id: "res-1", line_item_id: "order-line" },
      { id: "res-2", line_item_id: "order-line" },
    ])
    await invoke.compensate(response.compensation, { container: scope })
    expect(inventory.updateReservationItems).toHaveBeenLastCalledWith([
      { id: "res-1", line_item_id: "cart-line" },
      { id: "res-2", line_item_id: "cart-line" },
    ])
  })

  it.each([
    [[], "missing reservations"],
    [[{ id: "r", line_item_id: null, inventory_item_id: "inv", quantity: 2 }], "orphan reservation"],
    [[{ id: "r", line_item_id: "cart-line", inventory_item_id: "inv", quantity: 1 }], "wrong quantity"],
  ])("rejects %s", async (reservations, _label: string) => {
    const { container: scope } = setup(reservations as any[])
    await expect(invoke({ expected: [{ cart_line_id: "cart-line", inventory_item_id: "inv", quantity: 2 }], order_items: [{ id: "order-line", metadata: { catalog_cart_line_id: "cart-line" } }] }, { container: scope })).rejects.toThrow("не соответствует")
  })
})

describe("payment and site-content mutation steps", () => {
  it("validates payment provider configuration and compensates status", async () => {
    const fetch = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true, status: 200 } as Response)
    const step = setPaymentProviderEnabledStep as any
    const service = {
      retrieveAdminPaymentProviderConfig: jest.fn()
        .mockResolvedValueOnce({ shop_id: "shop", secret_key_set: true, is_enabled: false })
        .mockResolvedValueOnce({ id: "yookassa", is_enabled: true }),
      retrieveRuntimePaymentProviderConfig: jest.fn().mockResolvedValue({
        provider_id: "yookassa",
        shop_id: "shop",
        secret_key: "secret",
        mode: "test",
        is_enabled: false,
      }),
      savePaymentProviderConfig: jest.fn(),
      isPaymentProviderAvailable: jest.fn().mockResolvedValue(false),
      setPaymentProviderAvailability: jest.fn(),
    }
    const query = {
      graph: jest.fn().mockResolvedValue({
        data: [{ id: "store-1", default_region_id: "region-1" }],
      }),
    }
    const scope = container((key) => (key === "query" ? query : service))
    const response = await step({ provider_id: "yookassa", is_enabled: true, actor_id: "user" }, { container: scope })
    expect(response.result).toEqual({ id: "yookassa", is_enabled: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    await step.compensate(response.compensation, { container: scope })
    expect(service.savePaymentProviderConfig).toHaveBeenLastCalledWith({ provider_id: "yookassa", is_enabled: false, actor_id: "user" })
    expect(service.setPaymentProviderAvailability).toHaveBeenLastCalledWith({
      provider_id: "yookassa",
      store_id: "store-1",
      region_id: "region-1",
      is_enabled: false,
    })
    await expect(step({ provider_id: "unknown", is_enabled: true, actor_id: "user" }, { container: scope })).rejects.toThrow("not found")
  })

  it("rejects invalid provider credentials before changing status", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: false, status: 401 } as Response)
    const step = setPaymentProviderEnabledStep as any
    const service = {
      retrieveAdminPaymentProviderConfig: jest.fn().mockResolvedValue({
        shop_id: "shop",
        secret_key_set: true,
        is_enabled: false,
      }),
      retrieveRuntimePaymentProviderConfig: jest.fn().mockResolvedValue({
        provider_id: "yookassa",
        shop_id: "shop",
        secret_key: "invalid-secret",
        mode: "test",
        is_enabled: false,
      }),
      savePaymentProviderConfig: jest.fn(),
    }

    await expect(
      step(
        { provider_id: "yookassa", is_enabled: true, actor_id: "user" },
        { container: container(() => service) }
      )
    ).rejects.toThrow("could not be verified")
    expect(service.savePaymentProviderConfig).not.toHaveBeenCalled()
  })

  it("rejects missing or incomplete payment configuration", async () => {
    const step = setPaymentProviderEnabledStep as any
    for (const existing of [null, { shop_id: "", secret_key_set: false }]) {
      const service = {
        retrieveAdminPaymentProviderConfig: jest.fn().mockResolvedValue(existing),
        retrieveRuntimePaymentProviderConfig: jest.fn().mockResolvedValue(null),
      }
      await expect(step({ provider_id: "yookassa", is_enabled: true, actor_id: "u" }, { container: container(() => service) })).rejects.toThrow()
    }
  })

  it("creates, updates and rolls back site links", async () => {
    const step = saveSiteLinkStep as any
    const service = {
      listSiteLinks: jest.fn().mockResolvedValueOnce([]),
      createSiteLinks: jest.fn().mockResolvedValue({ id: "link-1" }),
      deleteSiteLinks: jest.fn(), updateSiteLinks: jest.fn(),
    }
    const scope = container(() => service)
    const created = await step({ kind: "social", url: "https://x" }, { container: scope })
    await step.compensate(created.compensation, { container: scope })
    expect(service.deleteSiteLinks).toHaveBeenCalledWith("link-1")

    service.listSiteLinks.mockReset().mockResolvedValueOnce([{ id: "reviews" }]).mockResolvedValueOnce([{ id: "reviews", label: "Old", url: "old" }])
    service.updateSiteLinks.mockResolvedValue({ id: "reviews", url: "new" })
    const updated = await step({ kind: "reviews", url: "new" }, { container: scope })
    await step.compensate(updated.compensation, { container: scope })
    expect(service.updateSiteLinks).toHaveBeenLastCalledWith({ id: "reviews", label: "Old", url: "old" })
  })

  it("sanitizes tabs, validates keys and compensates create/update/delete", async () => {
    const step = upsertSiteTabStep as any
    const service = {
      listSiteTabs: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "tab", content: "old" }]),
      createSiteTabs: jest.fn().mockResolvedValue({ id: "tab" }),
      updateSiteTabs: jest.fn().mockResolvedValue({ id: "tab" }),
      deleteSiteTabs: jest.fn(),
    }
    const scope = container(() => service)
    const created = await step({ key: "about", content: "<script>x</script><b>ok</b>" }, { container: scope })
    expect(service.createSiteTabs).toHaveBeenCalledWith({ key: "about", content: "<b>ok</b>" })
    await step.compensate(created.compensation, { container: scope })
    expect(service.deleteSiteTabs).toHaveBeenCalledWith("tab")
    const updated = await step({ key: "about", content: " " }, { container: scope })
    await step.compensate(updated.compensation, { container: scope })
    expect(service.updateSiteTabs).toHaveBeenLastCalledWith({ id: "tab", content: "old" })
    await expect(step({ key: "bad", content: "x" }, { container: scope })).rejects.toThrow("Unknown tab")
  })

  it("deletes and restores a site link", async () => {
    const step = deleteSiteLinkStep as any
    const existing = { id: "link", kind: "social", label: "X", url: "https://x", rank: 2 }
    const service = { listSiteLinks: jest.fn().mockResolvedValue([existing]), deleteSiteLinks: jest.fn(), createSiteLinks: jest.fn() }
    const scope = container(() => service)
    const response = await step({ id: "link" }, { container: scope })
    await step.compensate(response.compensation, { container: scope })
    expect(service.createSiteLinks).toHaveBeenCalledWith(existing)
    service.listSiteLinks.mockResolvedValue([])
    await expect(step({ id: "missing" }, { container: scope })).rejects.toThrow("not found")
  })
})
