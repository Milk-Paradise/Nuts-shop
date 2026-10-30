import {
  downloadCdekFulfillmentLabel,
  getCdekFulfillmentLabel,
} from "../get-cdek-fulfillment-label"
import { encryptShippingProviderCredentials } from "../../modules/shipping-provider-registry/credentials"
import { CdekFulfillmentError } from "../../providers/fulfillment-cdek/service"

describe("getCdekFulfillmentLabel", () => {
  const previousKey = process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = "test-encryption-key"
  })

  afterAll(() => {
    if (previousKey === undefined) delete process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY
    else process.env.SHIPPING_PROVIDER_CONFIG_ENCRYPTION_KEY = previousKey
  })

  it("requests a form once and returns a clear retry state until PRINT_FORM arrives", async () => {
    const shipment = {
      id: "ship_1",
      order_id: "order_1",
      provider_key: "cdek_cdek",
      status: "created",
      provider_shipment_id: "cdek-order-uuid",
      label_request_uuid: null as string | null,
      label_url: null as string | null,
    }
    const requestCdekFulfillmentLabel = jest.fn()
      .mockResolvedValue({ uuid: "print-uuid", url: null })
    const service = {
      listShippingShipments: jest.fn().mockImplementation(async () => [shipment]),
      getProviderConfig: jest.fn().mockResolvedValue({
        encrypted_credentials: encryptShippingProviderCredentials({
          client_id: "client-id",
          client_secret: "client-secret",
        }),
      }),
      updateShippingShipments: jest.fn().mockImplementation(async (input) => {
        Object.assign(shipment, input)
        return shipment
      }),
      requestCdekFulfillmentLabel,
    }
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === "shippingProviderRegistry") return service
        if (key === "locking") return { execute: (_key, callback) => callback() }
        throw new Error(`Unexpected dependency: ${key}`)
      }),
    }

    await expect(getCdekFulfillmentLabel(container as never, "order_1"))
      .resolves.toEqual({
        status: "not_ready",
        message: "Этикетка ещё не готова у СДЭК. Подождите минуту и повторите попытку.",
      })
    await expect(getCdekFulfillmentLabel(container as never, "order_1"))
      .resolves.toMatchObject({ status: "not_ready" })
    expect(requestCdekFulfillmentLabel).toHaveBeenCalledTimes(1)
    expect(service.updateShippingShipments).toHaveBeenCalledTimes(1)
  })

  function setup(
    shipment: any,
    config: any = {
      encrypted_credentials: encryptShippingProviderCredentials({
        client_id: "client-id",
        client_secret: "client-secret",
      }),
    },
    labelMethods: Record<string, unknown> = {}
  ) {
    const service = {
      listShippingShipments: jest.fn().mockResolvedValue(shipment ? [shipment] : []),
      getProviderConfig: jest.fn().mockResolvedValue(config),
      updateShippingShipments: jest.fn(),
      ...labelMethods,
    }
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === "shippingProviderRegistry") return service
        if (key === "locking") return { execute: (_key, callback) => callback() }
        throw new Error(`Unexpected dependency: ${key}`)
      }),
    }
    return { service, container: container as any }
  }

  it.each([
    null,
    { status: "created", provider_shipment_id: null },
    { status: "failed", provider_shipment_id: "shipment-1" },
  ])("skips a shipment that cannot have a label %#", async (shipment) => {
    const { container } = setup(shipment)
    await expect(getCdekFulfillmentLabel(container, "order_1"))
      .resolves.toEqual({ status: "skipped", reason: "shipment_not_created" })
  })

  it("reports missing credentials without calling CDEK", async () => {
    const requestCdekFulfillmentLabel = jest.fn()
    const { container } = setup({
      id: "ship_1", status: "created", provider_shipment_id: "shipment-1",
    }, null, { requestCdekFulfillmentLabel })
    await expect(getCdekFulfillmentLabel(container, "order_1"))
      .resolves.toEqual({ status: "failed", error: "Конфигурация СДЭК не найдена." })
    expect(requestCdekFulfillmentLabel).not.toHaveBeenCalled()
  })

  it("confirms a stored/requested label and distinguishes 409 from hard failures", async () => {
    const shipment = {
      id: "ship_1",
      status: "created",
      provider_shipment_id: "shipment-1",
      label_request_uuid: "print-1",
      label_url: "https://cdek.test/label.pdf",
    }
    const readyService = {
      downloadCdekFulfillmentLabel: jest.fn().mockResolvedValue(Buffer.from("pdf")),
    }
    const ready = setup(shipment, undefined, readyService)
    await expect(getCdekFulfillmentLabel(ready.container, "order_1"))
      .resolves.toEqual({ status: "ready" })

    const pendingService = {
      downloadCdekFulfillmentLabel: jest.fn().mockRejectedValue(
        new CdekFulfillmentError({ message: "not ready", status: 409 } as any)
      ),
    }
    const pending = setup(shipment, undefined, pendingService)
    await expect(getCdekFulfillmentLabel(pending.container, "order_1"))
      .resolves.toMatchObject({ status: "not_ready" })

    const failedService = {
      downloadCdekFulfillmentLabel: jest.fn().mockRejectedValue("gateway"),
    }
    const failed = setup(shipment, undefined, failedService)
    await expect(getCdekFulfillmentLabel(failed.container, "order_1"))
      .resolves.toEqual({ status: "failed", error: "gateway" })
  })

  it("confirms an immediate URL and maps request failures", async () => {
    const shipment = {
      id: "ship_1",
      status: "created",
      provider_shipment_id: "shipment-1",
      label_request_uuid: null,
      label_url: null,
    }
    const immediateService = {
      requestCdekFulfillmentLabel: jest.fn().mockResolvedValue({
        uuid: "print-1", url: "https://cdek.test/label.pdf",
      }),
      downloadCdekFulfillmentLabel: jest.fn().mockResolvedValue(Buffer.from("pdf")),
    }
    const immediate = setup(shipment, undefined, immediateService)
    await expect(getCdekFulfillmentLabel(immediate.container, "order_1"))
      .resolves.toEqual({ status: "ready" })
    expect(immediate.service.updateShippingShipments).toHaveBeenCalledWith({
      id: "ship_1",
      label_request_uuid: "print-1",
      label_url: "https://cdek.test/label.pdf",
    })

    for (const failure of [new Error("network"), { code: "bad" }]) {
      const failedService = {
        requestCdekFulfillmentLabel: jest.fn().mockRejectedValue(failure),
      }
      const failed = setup(shipment, undefined, failedService)
      await expect(getCdekFulfillmentLabel(failed.container, "order_1"))
        .resolves.toEqual({
          status: "failed",
          error: failure instanceof Error ? "network" : "[object Object]",
        })
    }
  })

  it("downloads only a ready label with configured credentials", async () => {
    const labelService = {
      downloadCdekFulfillmentLabel: jest.fn().mockResolvedValue(Buffer.from("pdf")),
    }
    const ready = setup({
      label_request_uuid: "print-1",
      label_url: "https://cdek.test/label.pdf",
    }, undefined, labelService)
    await expect(downloadCdekFulfillmentLabel(ready.container, "order_1"))
      .resolves.toEqual(Buffer.from("pdf"))

    for (const shipment of [null, { label_request_uuid: null, label_url: "url" }, { label_request_uuid: "id", label_url: null }]) {
      const notReady = setup(shipment)
      await expect(downloadCdekFulfillmentLabel(notReady.container, "order_1"))
        .rejects.toThrow("ещё не готова")
    }

    const unconfigured = setup({ label_request_uuid: "id", label_url: "url" }, {})
    await expect(downloadCdekFulfillmentLabel(unconfigured.container, "order_1"))
      .rejects.toThrow("не найдена")
  })
})
