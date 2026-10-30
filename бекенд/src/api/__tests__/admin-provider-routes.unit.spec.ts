const workflows = {
  configure: jest.fn(), savePackage: jest.fn(), setPayment: jest.fn(),
}
jest.mock("../../workflows/configure-cdek-provider", () => ({
  configureCdekProviderWorkflow: () => ({ run: workflows.configure }),
  resolveCdekCredentials: jest.fn(async (_scope, input) => ({
    client_id: input.client_id ?? "stored-id",
    client_secret: input.client_secret ?? "stored-secret",
  })),
}))
jest.mock("../../workflows/save-shipping-store-package", () => ({
  saveShippingStorePackageWorkflow: () => ({ run: workflows.savePackage }),
}))
jest.mock("../../workflows/set-payment-provider-enabled", () => ({
  setPaymentProviderEnabledWorkflow: () => ({ run: workflows.setPayment }),
}))

import { CdekFulfillmentError } from "../../providers/fulfillment-cdek/service"
import { GET as getCdek, POST as saveCdek } from "../admin/shipping-providers/cdek/route"
import { listCdekTariffs, POST as listTariffs } from "../admin/shipping-providers/cdek/tariffs/route"
import { GET as getPackage, POST as savePackage } from "../admin/shipping-providers/package/route"
import { GET as listPayments } from "../admin/payment-providers/route"
import { POST as setPaymentStatus } from "../admin/payment-providers/[provider_id]/status/route"

function response() {
  const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) }
  return res
}
function request(service: any = {}, overrides: Record<string, unknown> = {}) {
  return {
    scope: { resolve: jest.fn(() => service) }, params: {}, validatedBody: {},
    auth_context: { actor_id: "admin_1" }, ...overrides,
  } as any
}

describe("admin provider route boundaries", () => {
  beforeEach(() => jest.clearAllMocks())

  it("reads and safely serializes an absent CDEK configuration", async () => {
    const res = response()
    await getCdek(request({ getProviderConfig: jest.fn().mockResolvedValue(null) }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ configured: false, credentials: null, configuration: null })
  })

  it("saves a CDEK configuration and maps expected upstream errors", async () => {
    workflows.configure.mockResolvedValueOnce({ result: { config: { configuration: { contract_type: "delivery" } } } })
    const res = response()
    await saveCdek(request({}, { validatedBody: { client_id: "id" } }), res)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ configured: true }))

    workflows.configure.mockRejectedValueOnce(
      new CdekFulfillmentError({ message: "invalid credentials", status: 400 } as any)
    )
    const bad = response(); await saveCdek(request(), bad)
    expect(bad.status).toHaveBeenCalledWith(400)
    expect(bad.json).toHaveBeenCalledWith({ message: "invalid credentials" })

    workflows.configure.mockRejectedValueOnce(
      new CdekFulfillmentError({ message: "temporary", status: 502 } as any)
    )
    const temporary = response(); await saveCdek(request(), temporary)
    expect(temporary.status).toHaveBeenCalledWith(502)

    const unexpected = new Error("unexpected")
    workflows.configure.mockRejectedValueOnce(unexpected)
    await expect(saveCdek(request(), response())).rejects.toBe(unexpected)
  })

  it("lists tariffs through the shipping provider registry and maps only CDEK errors", async () => {
    const storePackage = { weight_grams: 1000, length_mm: 300, width_mm: 200, height_mm: 150 }
    const service = {
      getStorePackage: jest.fn().mockResolvedValue(storePackage),
      listCdekTariffs: jest.fn().mockResolvedValue([{ code: 136, name: "ПВЗ" }]),
    }
    await expect(listCdekTariffs({
      resolve: jest.fn(() => service),
    } as any, {
      client_id: "id", client_secret: "secret",
    } as any)).resolves.toEqual([{ code: 136, name: "ПВЗ" }])

    const routeService = {
      getStorePackage: jest.fn().mockResolvedValue(storePackage),
      listCdekTariffs: jest.fn().mockResolvedValue([{ code: 136, name: "ПВЗ" }]),
    }
    const routeRequest = () => request({}, {
      validatedBody: {},
      scope: { resolve: jest.fn(() => routeService) },
    })
    const res = response(); await listTariffs(routeRequest(), res)
    expect(res.json).toHaveBeenCalledWith({ tariffs: [{ code: 136, name: "ПВЗ" }] })

    routeService.listCdekTariffs.mockRejectedValueOnce(
      new CdekFulfillmentError({ message: "no tariffs", status: 409 } as any)
    )
    const bad = response(); await listTariffs(routeRequest(), bad)
    expect(bad.status).toHaveBeenCalledWith(409)

    const unexpected = new Error("unexpected")
    routeService.listCdekTariffs.mockRejectedValueOnce(unexpected)
    await expect(listTariffs(routeRequest(), response())).rejects.toBe(unexpected)
  })

  it("reads and writes the singleton store package", async () => {
    const stored = { id: "default", weight_grams: 1000 }
    const res = response(); await getPackage(request({ getStorePackage: jest.fn().mockResolvedValue(stored) }), res)
    expect(res.json).toHaveBeenCalledWith({ store_package: stored, unavailable_reason: null })

    const absent = response(); await getPackage(request({ getStorePackage: jest.fn().mockResolvedValue(null) }), absent)
    expect(absent.json).toHaveBeenCalledWith({
      store_package: null,
      unavailable_reason: expect.stringContaining("Коробка магазина не задана"),
    })

    workflows.savePackage.mockResolvedValue({ result: stored })
    const saved = response(); await savePackage(request({}, { validatedBody: { weight_grams: 1000 } }), saved)
    expect(saved.json).toHaveBeenCalledWith({ store_package: stored })
  })

  it("lists admin payment providers and passes actor identity on a status change", async () => {
    const providers = [{ id: "yookassa", is_enabled: true }]
    const res = response(); await listPayments(request({ listAdminPaymentProviders: jest.fn().mockResolvedValue(providers) }), res)
    expect(res.json).toHaveBeenCalledWith({ payment_providers: providers })

    workflows.setPayment.mockResolvedValue({ result: providers[0] })
    const statusRes = response()
    await setPaymentStatus(request({}, {
      params: { provider_id: "yookassa" }, validatedBody: { is_enabled: false },
    }), statusRes)
    expect(workflows.setPayment).toHaveBeenCalledWith({ input: {
      provider_id: "yookassa", is_enabled: false, actor_id: "admin_1",
    } })
    expect(statusRes.json).toHaveBeenCalledWith({ payment_provider: providers[0] })
  })
})
