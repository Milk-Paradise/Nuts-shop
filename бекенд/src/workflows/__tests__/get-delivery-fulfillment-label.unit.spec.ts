jest.mock("../get-cdek-fulfillment-label", () => ({
  getCdekFulfillmentLabel: jest.fn(),
}))
import { getDeliveryFulfillmentLabel } from "../get-delivery-fulfillment-label"

const { getCdekFulfillmentLabel } = jest.requireMock("../get-cdek-fulfillment-label")

function containerWithOrder(order: unknown) {
  const query = { graph: jest.fn().mockResolvedValue({ data: [order] }) }
  return { resolve: jest.fn().mockReturnValue(query) } as any
}

describe("getDeliveryFulfillmentLabel", () => {
  beforeEach(() => jest.clearAllMocks())

  it("dispatches a CDEK order through its label adapter", async () => {
    getCdekFulfillmentLabel.mockResolvedValue({ status: "ready" })
    const container = containerWithOrder({ shipping_methods: [{ data: { cdekData: {} } }] })

    await expect(getDeliveryFulfillmentLabel(container, "order_1"))
      .resolves.toEqual({ status: "ready" })
    expect(getCdekFulfillmentLabel).toHaveBeenCalledWith(container, "order_1")
  })

  it("does not manufacture a label for an unsupported delivery method", async () => {
    await expect(getDeliveryFulfillmentLabel(
      containerWithOrder({ shipping_methods: [{ data: { store_pickup: true } }] }),
      "order_1"
    )).resolves.toEqual({ status: "skipped", reason: "label_not_supported" })
  })
})
