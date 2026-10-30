const mockPlaceOrderRun = jest.fn()
const mockCartValidation = jest.fn()

jest.mock("../../../workflows/place-catalog-order", () => ({
  placeCatalogOrderWorkflow: () => ({ run: mockPlaceOrderRun }),
}))
jest.mock("../../../workflows/steps/catalog-checkout", () => {
  const actual = jest.requireActual("../../../workflows/steps/catalog-checkout")
  return {
    ...actual,
    getCatalogCheckoutCartValidation: (...args: unknown[]) => mockCartValidation(...args),
  }
})

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CatalogOrderFixationConflictError,
} from "../../../lib/catalog-order-fixation"
import {
  CatalogCheckoutCartValidationError,
  CatalogCheckoutShippingNotSelectedError,
  CatalogCheckoutShippingProviderHiddenError,
} from "../../../workflows/steps/catalog-checkout"
import { checkoutCatalogOrder as POST } from "../handlers"

function response() {
  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  }
  return res
}

function request(order: Record<string, unknown> = { id: "order_1", display_id: 42 }) {
  const query = { graph: jest.fn().mockResolvedValue({ data: [order] }) }
  return {
    scope: {
      resolve: jest.fn((key) => {
        if (key === ContainerRegistrationKeys.QUERY) return query
        throw new Error(`Unexpected dependency: ${String(key)}`)
      }),
    },
    validatedBody: {
      cart_id: "cart_1",
      name: "Иван",
      phone: "+79990000000",
      email: "buyer@test.com",
      city: "Москва",
      comment: "",
    },
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPlaceOrderRun.mockResolvedValue({ result: { order_id: "order_1" } })
  mockCartValidation.mockResolvedValue([])
})

it("places the order for a guest/authenticated customer and normalizes display_id", async () => {
  const guest = request({ id: "order_1" })
  const guestRes = response()
  await POST(guest, guestRes)
  expect(mockPlaceOrderRun).toHaveBeenCalledWith({
    input: expect.objectContaining({
      cart_id: "cart_1",
      name: "Иван",
      phone: "+79990000000",
      email: "buyer@test.com",
      city: "Москва",
      customer_id: null,
    }),
  })
  expect(guestRes.json).toHaveBeenCalledWith({
    type: "order",
    order: { id: "order_1", display_id: null },
  })

  const authenticated = request()
  authenticated.auth_context = { actor_id: "cus_1" }
  await POST(authenticated, response())
  expect(mockPlaceOrderRun).toHaveBeenLastCalledWith({
    input: expect.objectContaining({ customer_id: "cus_1" }),
  })
})

it("returns a stable conflict when a cart was claimed by different checkout data", async () => {
  mockPlaceOrderRun.mockRejectedValueOnce(new CatalogOrderFixationConflictError())
  const res = response()

  await POST(request(), res)

  expect(res.status).toHaveBeenCalledWith(409)
  expect(res.json).toHaveBeenCalledWith({
    type: "checkout",
    message: "Checkout request conflicts with the order already created for this cart",
  })
  expect(mockCartValidation).not.toHaveBeenCalled()
})

it("maps typed cart and shipping failures to stable 409 contracts", async () => {
  const unavailable = [{ variant_id: "variant_1", purchasable: false }]
  for (const [error, expected] of [
    [new CatalogCheckoutCartValidationError(unavailable as any), {
      type: "cart", message: "Cart contains unavailable items", items: unavailable,
    }],
    [new CatalogCheckoutShippingProviderHiddenError(), {
      type: "shipping", message: "Selected shipping method is no longer available",
    }],
    [new CatalogCheckoutShippingNotSelectedError(), {
      type: "shipping", message: "Shipping method has not been selected",
    }],
  ] as const) {
    mockPlaceOrderRun.mockRejectedValueOnce(error)
    const res = response()
    await POST(request(), res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expected)
  }
})

it("revalidates an unknown failure and returns a cart conflict if inventory changed", async () => {
  const failure = new Error("complete cart failed")
  mockPlaceOrderRun.mockRejectedValueOnce(failure)
  const items = [{ variant_id: "variant_1", purchasable: false }]
  mockCartValidation.mockResolvedValueOnce(items)
  const res = response()
  await POST(request(), res)
  expect(res.status).toHaveBeenCalledWith(409)
  expect(res.json).toHaveBeenCalledWith({
    type: "cart",
    message: "Cart contains unavailable items",
    items,
  })
})

it("rethrows the original failure when revalidation stays valid or also fails", async () => {
  for (const validation of [
    () => Promise.resolve([{ variant_id: "variant_1", purchasable: true }]),
    () => Promise.reject(new Error("cart missing")),
  ]) {
    const failure = new Error("complete cart failed")
    mockPlaceOrderRun.mockRejectedValueOnce(failure)
    mockCartValidation.mockImplementationOnce(validation)
    await expect(POST(request(), response())).rejects.toBe(failure)
  }
})
