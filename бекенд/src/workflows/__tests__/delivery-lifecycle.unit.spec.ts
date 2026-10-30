import { createDeliveryOrderFulfillmentIfNeeded } from "../delivery-lifecycle"
import { selectedVisibleDeliveryProviderKeys } from "../../modules/shipping-provider-registry/lifecycle-selection"

jest.mock("../create-cdek-order-fulfillment", () => ({
  findCdekShippingMethod: jest.fn((order) =>
    order?.shipping_methods?.find((method) => method.data?.cdekData) ?? null
  ),
  createCdekOrderFulfillmentIfNeeded: jest.fn(),
}))
jest.mock("../create-ozon-order-fulfillment", () => ({
  findOzonShippingMethod: jest.fn((order) =>
    order?.shipping_methods?.find((method) => method.data?.ozonData) ?? null
  ),
  createOzonOrderFulfillmentIfNeeded: jest.fn(),
}))

const { createCdekOrderFulfillmentIfNeeded } = jest.requireMock("../create-cdek-order-fulfillment")
const { createOzonOrderFulfillmentIfNeeded } = jest.requireMock("../create-ozon-order-fulfillment")

describe("delivery lifecycle adapters", () => {
  beforeEach(() => jest.clearAllMocks())

  it("revalidates only selected direct providers", () => {
    expect(selectedVisibleDeliveryProviderKeys({
      shipping_methods: [
        { shipping_option: { provider_id: "manual_manual" } },
        { shipping_option: { provider_id: "cdek_cdek" } },
        { shipping_option: { provider_id: "ozon_ozon" } },
      ],
    })).toEqual(["cdek_cdek", "ozon_ozon"])
  })

  it("dispatches CDEK fulfillment through the selected adapter", async () => {
    createCdekOrderFulfillmentIfNeeded.mockResolvedValue({ status: "created" })

    await expect(createDeliveryOrderFulfillmentIfNeeded({} as any, "order_1", {
      shipping_methods: [{ data: { cdekData: {} } }],
    })).resolves.toEqual({ status: "created" })

    expect(createCdekOrderFulfillmentIfNeeded).toHaveBeenCalledWith({}, "order_1")
    expect(createOzonOrderFulfillmentIfNeeded).not.toHaveBeenCalled()
  })

  it("dispatches Ozon fulfillment through the selected adapter", async () => {
    createOzonOrderFulfillmentIfNeeded.mockResolvedValue({ status: "created" })

    await expect(createDeliveryOrderFulfillmentIfNeeded({} as any, "order_2", {
      shipping_methods: [{ data: { ozonData: {} } }],
    })).resolves.toEqual({ status: "created" })

    expect(createOzonOrderFulfillmentIfNeeded).toHaveBeenCalledWith({}, "order_2")
    expect(createCdekOrderFulfillmentIfNeeded).not.toHaveBeenCalled()
  })

  it("does not create carrier fulfillment for unsupported methods", async () => {
    await expect(createDeliveryOrderFulfillmentIfNeeded({} as any, "order_1", {
      shipping_methods: [{ data: { store_pickup: true } }],
    })).resolves.toEqual({ status: "skipped", reason: "unsupported_delivery_method" })
  })
})
