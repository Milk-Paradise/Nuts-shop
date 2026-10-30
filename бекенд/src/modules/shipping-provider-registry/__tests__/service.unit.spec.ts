import ShippingProviderRegistryModuleService from "../service"
import { CdekApiError, CdekClient } from "../cdek-client"
import { OzonApiError, OzonClient } from "../ozon-client"
import { CDEK_PROVIDER_KEY, OZON_PROVIDER_KEY } from "../provider-keys"
import { encryptShippingProviderCredentials } from "../credentials"
import { CdekFulfillmentError } from "../../../providers/fulfillment-cdek/service"
import { OzonFulfillmentError } from "../../../providers/fulfillment-ozon/service"

const mockCdekTestAuthorization = jest.fn()
const mockCdekFindOrderByNumber = jest.fn()
const mockCdekCreateOrder = jest.fn()
const mockCdekListAvailableTariffs = jest.fn()
const mockCdekListDeliveryPoints = jest.fn()
const mockCdekRequestBarcodeLabel = jest.fn()
const mockCdekDownloadBarcodeLabel = jest.fn()
const mockOzonTestAuthorization = jest.fn()
const mockOzonCreateReturn = jest.fn()
const mockOzonVerifyWebhook = jest.fn()
const mockOzonListPickupPoints = jest.fn()

jest.mock("../cdek-client", () => ({
  ...jest.requireActual("../cdek-client"),
  CdekClient: jest.fn(),
}))

jest.mock("../ozon-client", () => ({
  ...jest.requireActual("../ozon-client"),
  OzonClient: jest.fn(),
}))

function makeService() {
  return Object.create(
    ShippingProviderRegistryModuleService.prototype
  ) as ShippingProviderRegistryModuleService
}

describe("ShippingProviderRegistryModuleService", () => {
  beforeEach(() => {
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "test-registry-key"
    mockCdekTestAuthorization.mockReset().mockResolvedValue(undefined)
    mockCdekFindOrderByNumber.mockReset().mockResolvedValue(null)
    mockCdekCreateOrder.mockReset().mockResolvedValue({
      uuid: "cdek-return-uuid",
      cdek_number: "cdek-return-track",
    })
    mockCdekListAvailableTariffs.mockReset().mockResolvedValue([])
    mockCdekListDeliveryPoints.mockReset().mockResolvedValue([])
    mockCdekRequestBarcodeLabel.mockReset()
      .mockResolvedValue({ uuid: "label-1", url: null })
    mockCdekDownloadBarcodeLabel.mockReset().mockResolvedValue(Buffer.from("pdf"))
    mockOzonTestAuthorization.mockReset().mockResolvedValue(true)
    mockOzonCreateReturn.mockReset().mockResolvedValue({ id: "ozon-return-id" })
    mockOzonVerifyWebhook.mockReset().mockReturnValue(true)
    mockOzonListPickupPoints.mockReset().mockResolvedValue([])
    jest.mocked(CdekClient).mockReset().mockImplementation(
      () => ({
        testAuthorization: mockCdekTestAuthorization,
        findOrderByNumber: mockCdekFindOrderByNumber,
        createOrder: mockCdekCreateOrder,
        listAvailableTariffs: mockCdekListAvailableTariffs,
        listDeliveryPoints: mockCdekListDeliveryPoints,
        requestBarcodeLabel: mockCdekRequestBarcodeLabel,
        downloadBarcodeLabel: mockCdekDownloadBarcodeLabel,
      }) as never
    )
    jest.mocked(OzonClient).mockReset().mockImplementation(
      () => ({
        testAuthorization: mockOzonTestAuthorization,
        createReturn: mockOzonCreateReturn,
        verifyWebhook: mockOzonVerifyWebhook,
        listPickupPoints: mockOzonListPickupPoints,
      }) as never
    )
  })

  it("tests CDEK credentials through a lazily created client", async () => {
    const service = makeService()
    const credentials = { client_id: "cdek-id", client_secret: "cdek-secret" }

    await expect(
      service.testProviderCredentials(CDEK_PROVIDER_KEY, credentials)
    ).resolves.toBeUndefined()
    expect(CdekClient).toHaveBeenCalledTimes(1)
    expect(mockCdekTestAuthorization).toHaveBeenCalledWith(credentials)
  })

  it("wraps a CDEK rejection in the fulfillment error", async () => {
    const service = makeService()
    mockCdekTestAuthorization.mockRejectedValue(
      new CdekApiError("invalid credentials", 400)
    )

    await expect(service.testProviderCredentials(CDEK_PROVIDER_KEY, {
      client_id: "cdek-id",
      client_secret: "wrong",
    })).rejects.toBeInstanceOf(CdekFulfillmentError)
  })

  it("lists CDEK tariffs through a lazily created client", async () => {
    const service = makeService()
    const credentials = { client_id: "cdek-id", client_secret: "cdek-secret" }
    const input = {
      contract_type: "online_store" as const,
      sender: { city: "Москва", postal_code: "101000" },
      package: {
        weight_grams: 1000,
        length_mm: 300,
        width_mm: 200,
        height_mm: 150,
      },
    }
    const tariffs = [{ code: 136, name: "Посылка склад — склад" }]
    mockCdekListAvailableTariffs.mockResolvedValue(tariffs)

    await expect(service.listCdekTariffs(credentials, input)).resolves.toEqual(tariffs)
    expect(CdekClient).toHaveBeenCalledTimes(1)
    expect(mockCdekListAvailableTariffs).toHaveBeenCalledWith(credentials, input)
  })

  it("wraps a CDEK tariff rejection in the fulfillment error", async () => {
    mockCdekListAvailableTariffs.mockRejectedValue(
      new CdekApiError("tariffs unavailable", 502)
    )

    await expect(makeService().listCdekTariffs(
      { client_id: "cdek-id", client_secret: "cdek-secret" },
      {
        contract_type: "online_store",
        sender: { city: "Москва", postal_code: "101000" },
        package: {
          weight_grams: 1000,
          length_mm: 300,
          width_mm: 200,
          height_mm: 150,
        },
      }
    )).rejects.toBeInstanceOf(CdekFulfillmentError)
  })

  it("tests Ozon credentials through a lazily created client", async () => {
    const service = makeService()
    const credentials = { client_id: "ozon-id", client_secret: "ozon-secret" }

    await expect(
      service.testProviderCredentials(OZON_PROVIDER_KEY, credentials)
    ).resolves.toBeUndefined()
    expect(OzonClient).toHaveBeenCalledTimes(1)
    expect(mockOzonTestAuthorization).toHaveBeenCalledWith(credentials)
  })

  it("verifies Ozon webhook signatures through a lazily created client", async () => {
    const service = makeService()
    const rawBody = Buffer.from("raw")
    const headers = { "x-ozon-signature": "signature" }
    mockOzonVerifyWebhook.mockReturnValueOnce(true).mockReturnValueOnce(false)

    await expect(service.verifyOzonWebhookSignature(rawBody, headers, "secret")).resolves.toBe(true)
    await expect(service.verifyOzonWebhookSignature(rawBody, headers, "wrong-secret")).resolves.toBe(false)
    expect(OzonClient).toHaveBeenCalledTimes(1)
    expect(mockOzonVerifyWebhook).toHaveBeenNthCalledWith(1, rawBody, headers, "secret")
    expect(mockOzonVerifyWebhook).toHaveBeenNthCalledWith(2, rawBody, headers, "wrong-secret")
  })

  it("wraps an Ozon rejection in the fulfillment error", async () => {
    const service = makeService()
    mockOzonTestAuthorization.mockRejectedValue(
      new OzonApiError("invalid credentials", 401, "UNAUTHORIZED", false, false)
    )

    await expect(service.testProviderCredentials(OZON_PROVIDER_KEY, {
      client_id: "ozon-id",
      client_secret: "wrong",
    })).rejects.toBeInstanceOf(OzonFulfillmentError)
  })

  it("lists CDEK pickup points through a lazily created client", async () => {
    const service = makeService()
    const credentials = { client_id: "cdek-id", client_secret: "cdek-secret" }
    const points = [{ code: "MSK-1" }]
    mockCdekListDeliveryPoints.mockResolvedValue(points)

    await expect(service.listCdekPickupPoints(credentials)).resolves.toBe(points)
    expect(CdekClient).toHaveBeenCalledTimes(1)
    expect(mockCdekListDeliveryPoints).toHaveBeenCalledWith(credentials)
  })

  it("wraps a CDEK pickup point rejection in the fulfillment error", async () => {
    mockCdekListDeliveryPoints.mockRejectedValue(
      new CdekApiError("pickup points unavailable", 502)
    )

    await expect(makeService().listCdekPickupPoints({
      client_id: "cdek-id",
      client_secret: "cdek-secret",
    })).rejects.toBeInstanceOf(CdekFulfillmentError)
  })

  it("lists Ozon pickup points through a lazily created client", async () => {
    const service = makeService()
    const credentials = { client_id: "ozon-id", client_secret: "ozon-secret" }
    const points = [{ id: "point-1" }]
    mockOzonListPickupPoints.mockResolvedValue(points)

    await expect(service.listOzonPickupPoints(credentials)).resolves.toBe(points)
    expect(OzonClient).toHaveBeenCalledTimes(1)
    expect(mockOzonListPickupPoints).toHaveBeenCalledWith(credentials)
  })

  it("wraps an Ozon pickup point rejection in the fulfillment error", async () => {
    mockOzonListPickupPoints.mockRejectedValue(
      new OzonApiError("pickup points unavailable", 502, "NETWORK_ERROR", true, false)
    )

    await expect(makeService().listOzonPickupPoints({
      client_id: "ozon-id",
      client_secret: "ozon-secret",
    })).rejects.toBeInstanceOf(OzonFulfillmentError)
  })

  it("normalizes CDEK client construction and carrier errors to the same class", async () => {
    jest.mocked(CdekClient).mockImplementationOnce(() => {
      throw new Error("construction failed")
    })
    await expect(makeService().testProviderCredentials(CDEK_PROVIDER_KEY, {
      client_id: "cdek-id",
      client_secret: "cdek-secret",
    })).rejects.toBeInstanceOf(CdekFulfillmentError)

    mockCdekTestAuthorization.mockRejectedValueOnce(
      new CdekApiError("offline", 502)
    )
    await expect(makeService().testProviderCredentials(CDEK_PROVIDER_KEY, {
      client_id: "cdek-id",
      client_secret: "cdek-secret",
    })).rejects.toBeInstanceOf(CdekFulfillmentError)
  })

  it("normalizes Ozon client construction and carrier errors to the same class", async () => {
    jest.mocked(OzonClient).mockImplementationOnce(() => {
      throw new Error("missing endpoint")
    })
    await expect(makeService().testProviderCredentials(OZON_PROVIDER_KEY, {
      client_id: "ozon-id",
      client_secret: "ozon-secret",
    })).rejects.toBeInstanceOf(OzonFulfillmentError)

    mockOzonTestAuthorization.mockRejectedValueOnce(
      new OzonApiError("offline", 502, "NETWORK_ERROR", true, false)
    )
    await expect(makeService().testProviderCredentials(OZON_PROVIDER_KEY, {
      client_id: "ozon-id",
      client_secret: "ozon-secret",
    })).rejects.toBeInstanceOf(OzonFulfillmentError)
  })

  it("reuses the client while testing consecutive credentials independently", async () => {
    const service = makeService()
    const first = { client_id: "first-id", client_secret: "first-secret" }
    const second = { client_id: "second-id", client_secret: "second-secret" }

    await service.testProviderCredentials(CDEK_PROVIDER_KEY, first)
    await service.testProviderCredentials(CDEK_PROVIDER_KEY, second)

    expect(CdekClient).toHaveBeenCalledTimes(1)
    expect(mockCdekTestAuthorization).toHaveBeenNthCalledWith(1, first)
    expect(mockCdekTestAuthorization).toHaveBeenNthCalledWith(2, second)
  })

  it("creates CDEK and Ozon returns through the same registry method", async () => {
    const service = makeService()
    const encryptedCredentials = encryptShippingProviderCredentials({
      client_id: "client-id",
      client_secret: "client-secret",
    })
    jest.spyOn(service, "getProviderConfig").mockImplementation(async (providerKey) => ({
      encrypted_credentials: encryptedCredentials,
      configuration: providerKey === CDEK_PROVIDER_KEY ? {
        contract_type: "online_store",
        sender: {
          city: "Москва",
          postal_code: "101000",
          street: "Тверская, 1",
          contact_name: "Магазин",
          phone: "+79990000000",
        },
      } : {},
    }) as never)
    jest.spyOn(service, "getStorePackage").mockResolvedValue({
      weight_grams: 1000,
      length_mm: 200,
      width_mm: 100,
      height_mm: 50,
    } as never)
    const input = {
      return_id: "return_1",
      forward_shipment_id: "forward_1",
      reason: "customer_return",
      order: {
        id: "order_1",
        display_id: 42,
        shipping_address: {
          city: "Тула",
          postal_code: "300000",
          address_1: "Ленина, 1",
          phone: "+79991111111",
        },
        items: [{ id: "item_1", title: "Краска", variant_sku: "SKU-1", quantity: 1 }],
        shipping_methods: [{ data: { cdekData: { tariff_code: 136 } } }],
      },
    }

    await expect(
      service.createCarrierReturnShipment(CDEK_PROVIDER_KEY, input)
    ).resolves.toEqual({
      id: "cdek-return-uuid",
      tracking_number: "cdek-return-track",
      register_shipment: true,
    })
    await expect(
      service.createCarrierReturnShipment(OZON_PROVIDER_KEY, input)
    ).resolves.toEqual({
      id: "ozon-return-id",
      tracking_number: null,
      register_shipment: false,
    })
    expect(mockOzonCreateReturn).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "client-id" }),
      {
        shipment_id: "forward_1",
        external_number: "return-return_1",
        reason: "customer_return",
      },
      "return:return_1"
    )
  })

  it("normalizes CDEK return failures to the fulfillment error", async () => {
    const service = makeService()
    jest.spyOn(service, "getProviderConfig").mockResolvedValue({
      encrypted_credentials: encryptShippingProviderCredentials({
        client_id: "cdek-id",
        client_secret: "cdek-secret",
      }),
      configuration: {
        sender: { city: "Москва", contact_name: "Магазин", phone: "+79990000000" },
      },
    } as never)
    jest.spyOn(service, "getStorePackage").mockResolvedValue({
      weight_grams: 1000,
      length_mm: 200,
      width_mm: 100,
      height_mm: 50,
    } as never)
    mockCdekFindOrderByNumber.mockRejectedValue(new Error("offline"))

    await expect(service.createCarrierReturnShipment(CDEK_PROVIDER_KEY, {
      return_id: "return_1",
      forward_shipment_id: "forward_1",
      reason: "customer_return",
      order: {
        id: "order_1",
        shipping_address: { city: "Тула", phone: "+79991111111" },
        shipping_methods: [{ data: { cdekData: { tariff_code: 136 } } }],
      },
    })).rejects.toBeInstanceOf(CdekFulfillmentError)
  })

  it("normalizes Ozon return failures to the fulfillment error", async () => {
    const service = makeService()
    jest.spyOn(service, "getProviderConfig").mockResolvedValue({
      encrypted_credentials: encryptShippingProviderCredentials({
        client_id: "ozon-id",
        client_secret: "ozon-secret",
      }),
      configuration: {},
    } as never)
    mockOzonCreateReturn.mockRejectedValue(new Error("offline"))

    await expect(service.createCarrierReturnShipment(OZON_PROVIDER_KEY, {
      return_id: "return_1",
      forward_shipment_id: "forward_1",
      reason: "customer_return",
      order: { id: "order_1" },
    })).rejects.toBeInstanceOf(OzonFulfillmentError)
  })

  it("reuses an existing CDEK return instead of creating another order", async () => {
    const service = makeService()
    jest.spyOn(service, "getProviderConfig").mockResolvedValue({
      encrypted_credentials: encryptShippingProviderCredentials({
        client_id: "cdek-id",
        client_secret: "cdek-secret",
      }),
      configuration: {
        sender: { city: "Москва", contact_name: "Магазин", phone: "+79990000000" },
      },
    } as never)
    jest.spyOn(service, "getStorePackage").mockResolvedValue({
      weight_grams: 1000,
      length_mm: 200,
      width_mm: 100,
      height_mm: 50,
    } as never)
    mockCdekFindOrderByNumber.mockResolvedValue({
      uuid: "existing-return-uuid",
      cdek_number: "existing-return-track",
    })

    await expect(service.createCarrierReturnShipment(CDEK_PROVIDER_KEY, {
      return_id: "return_1",
      forward_shipment_id: "forward_1",
      reason: "customer_return",
      order: {
        id: "order_1",
        shipping_address: { city: "Тула", phone: "+79991111111" },
        shipping_methods: [{ data: { cdekData: { tariff_code: 136 } } }],
      },
    })).resolves.toEqual({
      id: "existing-return-uuid",
      tracking_number: "existing-return-track",
      register_shipment: true,
    })
    expect(mockCdekFindOrderByNumber).toHaveBeenCalledWith(
      expect.any(Object),
      "return-return_1"
    )
    expect(mockCdekCreateOrder).not.toHaveBeenCalled()
  })

  it("requests and downloads CDEK labels through the lazy client", async () => {
    const service = makeService()
    const credentials = { client_id: "cdek-id", client_secret: "cdek-secret" }

    await expect(
      service.requestCdekFulfillmentLabel(credentials, "shipment-1")
    ).resolves.toEqual({ uuid: "label-1", url: null })
    await expect(
      service.downloadCdekFulfillmentLabel(credentials, "label-1")
    ).resolves.toEqual(Buffer.from("pdf"))

    expect(CdekClient).toHaveBeenCalledTimes(1)
    expect(mockCdekRequestBarcodeLabel).toHaveBeenCalledWith(credentials, "shipment-1")
    expect(mockCdekDownloadBarcodeLabel).toHaveBeenCalledWith(credentials, "label-1")
  })

  it("normalizes CDEK label errors and preserves status", async () => {
    const service = makeService()
    const credentials = { client_id: "cdek-id", client_secret: "cdek-secret" }
    mockCdekRequestBarcodeLabel.mockRejectedValueOnce(
      new CdekApiError("request failed", 502)
    )
    mockCdekDownloadBarcodeLabel.mockRejectedValueOnce(
      new CdekApiError("not ready", 409)
    )

    await expect(
      service.requestCdekFulfillmentLabel(credentials, "shipment-1")
    ).rejects.toBeInstanceOf(CdekFulfillmentError)
    const pendingError = await service
      .downloadCdekFulfillmentLabel(credentials, "label-1")
      .catch((error) => error)
    expect(pendingError).toBeInstanceOf(CdekFulfillmentError)
    expect(pendingError).toMatchObject({ status: 409 })
  })

  it("returns the matching provider configuration or null", async () => {
    const service = makeService()
    const list = jest.spyOn(service, "listShippingProviderConfigs")

    list.mockResolvedValueOnce([{ id: "config_1" }] as never)
    await expect(service.getProviderConfig("cdek_cdek")).resolves.toEqual({ id: "config_1" })
    expect(list).toHaveBeenCalledWith({ provider_key: "cdek_cdek" })

    list.mockResolvedValueOnce([])
    await expect(service.getProviderConfig("missing")).resolves.toBeNull()
  })

  it("re-encrypts legacy provider credentials when the configuration is read", async () => {
    process.env.SECRET_ENCRYPTION_KEY =
      "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg="
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "legacy-shipping-key"
    const service = makeService()
    jest.spyOn(service, "listShippingProviderConfigs").mockResolvedValue([
      {
        id: "config_1",
        encrypted_credentials:
          "v1.AgICAgICAgICAgIC.xRX1Jkx0CMJkJCf3nEqixA.A3Y2-n3P7e_rbKw7cRi8M0V8dW4mLi6x1H_rFhUS2RMc2lBnfFqGT5gntw19Kf66g2YPnHzw5x7IFyj-UjrgsuXqrsAGGQ",
      },
    ] as never)
    const update = jest
      .spyOn(service, "updateShippingProviderConfigs")
      .mockImplementation(async (input) => input as never)

    await expect(service.getProviderConfig("cdek_cdek")).resolves.toEqual(
      expect.objectContaining({
        encrypted_credentials: expect.stringMatching(/^v2:/),
      })
    )
    expect(update).toHaveBeenCalledWith({
      id: "config_1",
      encrypted_credentials: expect.stringMatching(/^v2:/),
    })
  })

  it("creates a provider configuration and encrypts supplied credentials", async () => {
    const service = makeService()
    jest.spyOn(service, "getProviderConfig").mockResolvedValue(null as never)
    const create = jest.spyOn(service, "createShippingProviderConfigs")
      .mockImplementation(async (input) => input as never)

    const result = await service.saveProviderConfig({
      providerKey: "cdek_cdek",
      credentials: { client_id: "client", client_secret: "secret" },
      configuration: { tariff_codes: [136] },
    })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      provider_key: "cdek_cdek",
      configuration: { tariff_codes: [136] },
      encrypted_credentials: expect.any(String),
    }))
    expect(JSON.stringify(result)).not.toContain('"secret"')
  })

  it("updates configuration while preserving omitted credentials", async () => {
    const service = makeService()
    jest.spyOn(service, "getProviderConfig").mockResolvedValue({
      id: "config_1",
      encrypted_credentials: "encrypted-existing",
    } as never)
    const update = jest.spyOn(service, "updateShippingProviderConfigs")
      .mockImplementation(async (input) => input as never)

    await service.saveProviderConfig({
      providerKey: "cdek_cdek",
      configuration: { tariff_codes: [234] },
    })

    expect(update).toHaveBeenCalledWith({
      id: "config_1",
      configuration: { tariff_codes: [234] },
      encrypted_credentials: "encrypted-existing",
    })
  })

  it("stores null credentials for a new configuration when none are supplied", async () => {
    const service = makeService()
    jest.spyOn(service, "getProviderConfig").mockResolvedValue(null as never)
    const create = jest.spyOn(service, "createShippingProviderConfigs")
      .mockImplementation(async (input) => input as never)

    await service.saveProviderConfig({ providerKey: "cdek_cdek", configuration: {} })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ encrypted_credentials: null }))
  })

  it("reads, creates, and updates the singleton store package", async () => {
    const service = makeService()
    const list = jest.spyOn(service, "listShippingStorePackages")
    list.mockResolvedValueOnce([{ id: "default", weight_grams: 1000 }] as never)
    await expect(service.getStorePackage()).resolves.toEqual({ id: "default", weight_grams: 1000 })
    expect(list).toHaveBeenCalledWith({ id: "default" })
    list.mockResolvedValueOnce([])
    await expect(service.getStorePackage()).resolves.toBeNull()

    const input = { weight_grams: 1000, length_mm: 200, width_mm: 100, height_mm: 50 }
    jest.spyOn(service, "getStorePackage").mockResolvedValueOnce(null as never)
    const create = jest.spyOn(service, "createShippingStorePackages")
      .mockImplementation(async (value) => value as never)
    await service.saveStorePackage(input)
    expect(create).toHaveBeenCalledWith({ id: "default", ...input })

    jest.spyOn(service, "getStorePackage").mockResolvedValueOnce({ id: "default" } as never)
    const update = jest.spyOn(service, "updateShippingStorePackages")
      .mockImplementation(async (value) => value as never)
    await service.saveStorePackage(input)
    expect(update).toHaveBeenCalledWith({ id: "default", ...input })
  })

  it("returns the shipment won by a concurrent idempotency claim", async () => {
    const service = makeService()
    const stored = { id: "shipment_1", status: "creating" }
    jest.spyOn(service, "listShippingShipments")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([stored] as never)
    jest.spyOn(service, "createShippingShipments")
      .mockRejectedValueOnce(new Error("unique constraint"))

    await expect(service.claimShippingShipment({
      order_id: "order_1",
      provider_key: "carrier",
      business_action_id: "fulfill-order_1",
      direction: "forward",
      destination_key: "address_1",
    })).resolves.toEqual({ shipment: stored, created: false })
  })
})
