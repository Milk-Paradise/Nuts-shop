const mockPricingRun = jest.fn()

jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: string, invoke: unknown) => invoke,
  StepResponse: class StepResponse<T> {
    constructor(readonly result: T) {}
  },
}))

jest.mock("@medusajs/medusa/core-flows", () => ({
  listShippingOptionsForCartWorkflow: jest.fn(),
  listShippingOptionsForCartWithPricingWorkflow: jest.fn(() => ({
    run: mockPricingRun,
  })),
}))

import { CDEK_PROVIDER_KEY } from "../../../modules/shipping-provider-registry"
import { prepareCatalogShippingSelectionStep } from "../prepare-catalog-shipping-selection"

beforeEach(() => jest.clearAllMocks())

describe("prepare catalog shipping selection", () => {
  it("prices only the selected option when another candidate has an unregistered provider", async () => {
    mockPricingRun.mockImplementation(async ({ input }) => {
      if (!input.options) {
        throw new Error("Could not resolve 'fp_apiship_apiship'")
      }

      return {
        result: [{
          id: "so_cdek",
          provider_id: CDEK_PROVIDER_KEY,
          calculated_price: {
            data: {
              tariff_codes: [{ code: 137 }],
            },
          },
        }],
      }
    })

    const response = await (prepareCatalogShippingSelectionStep as any)(
      {
        cart_id: "cart_1",
        option_id: "so_cdek:courier:cdek:137",
        pickup_point: null,
      },
      { container: {} }
    )

    expect(mockPricingRun).toHaveBeenCalledWith({
      input: {
        cart_id: "cart_1",
        options: [{ id: "so_cdek" }],
      },
    })
    expect(response.result).toEqual({
      selected_id: "so_cdek",
      options: [{
        id: "so_cdek",
        data: { cdekData: { tariff_code: 137 } },
      }],
    })
  })
})
