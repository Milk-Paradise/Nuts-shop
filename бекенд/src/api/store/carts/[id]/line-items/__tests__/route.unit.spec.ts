const run = jest.fn()
const retrieveCart = jest.fn()
const getVersion = jest.fn()

jest.mock("../../../../../../workflows/add-line-item-with-version", () => ({
  addLineItemWithVersionWorkflow: jest.fn(() => ({ run })),
}))

import { MedusaError, Modules } from "@medusajs/framework/utils"

import { POST } from "../route"

function response() {
  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  }
  return res
}

function request(version: unknown) {
  return {
    params: { id: "cart_1" },
    headers: version === undefined ? {} : { "x-cart-version": version },
    validatedBody: {
      variant_id: "variant_1",
      quantity: 2,
    },
    scope: {
      resolve: jest.fn((key: string) =>
        key === Modules.CART ? { retrieveCart } : { getVersion }
      ),
    },
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  run.mockResolvedValue({ result: { version: 4 } })
  retrieveCart.mockResolvedValue({
    id: "cart_1",
    items: [{ id: "line_1" }],
    updated_at: "2026-10-13T00:00:00.000Z",
    currency_code: "rub",
    email: null,
  })
})

describe("POST /store/carts/:id/line-items", () => {
  it.each([
    ["a missing header", undefined],
    ["an empty header", ""],
    ["a non-number", "invalid"],
    ["a negative integer", "-1"],
    ["a fractional number", "1.5"],
    ["an unsafe integer", "9007199254740992"],
    ["multiple values", ["1", "2"]],
  ])("rejects %s before starting the workflow", async (_case, version) => {
    const res = response()

    await POST(request(version), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      type: "invalid_data",
      message: "X-Cart-Version must be a non-negative safe integer",
    })
    expect(run).not.toHaveBeenCalled()
  })

  it("passes the header version and the core-validated body to the workflow", async () => {
    const res = response()

    await POST(request("0"), res)

    expect(run).toHaveBeenCalledWith({
      input: {
        cart_id: "cart_1",
        expected_version: 0,
        variant_id: "variant_1",
        quantity: 2,
      },
    })
    expect(res.status).toHaveBeenCalledWith(200)
    // Витрина (storeRequest<StoreCartResponse>) всегда ждёт { cart: {...} } —
    // плоский { id, cart_id, variant_id, quantity, version } ломал normalizeCart
    // на фронте (live-репро на qa-a: 200 от backend, но "не удалось обновить
    // корзину" на экране).
    expect(res.json).toHaveBeenCalledWith({
      cart: {
        id: "cart_1",
        version: 4,
        items: [{ id: "line_1" }],
        updated_at: "2026-10-13T00:00:00.000Z",
        currency_code: "rub",
        email: null,
      },
    })
  })

  it("builds the 409 conflict cart via getVersion, not query.graph or Modules.CART.version", async () => {
    // workflow-engine-redis сериализует ошибку шага через JSON (см. комментарий
    // в route.ts): она доходит сюда как обычный объект с полем type, а не как
    // экземпляр MedusaError — именно это и ловит тест, а не new MedusaError(...).
    run.mockRejectedValue({
      type: MedusaError.Types.CONFLICT,
      message: "Cart version mismatch: expected 0, got 1",
    })
    retrieveCart.mockResolvedValue({
      id: "cart_1",
      // Modules.CART.retrieveCart never actually returns version (that's
      // the AIL-502 regression this test guards against) — a wrong-looking
      // value here proves the response's version came from getVersion.
      version: 999,
      items: [{ id: "line_1" }],
      updated_at: "2026-10-13T00:00:00.000Z",
      currency_code: "rub",
      email: null,
    })
    getVersion.mockResolvedValue(1)
    const res = response()

    await POST(request("0"), res)

    expect(retrieveCart).toHaveBeenCalledWith("cart_1", { relations: ["items"] })
    expect(getVersion).toHaveBeenCalledWith("cart_1")
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      code: "CART_VERSION_CONFLICT",
      message: "Cart version mismatch: expected 0, got 1",
      cart: {
        id: "cart_1",
        version: 1,
        items: [{ id: "line_1" }],
        updated_at: "2026-10-13T00:00:00.000Z",
        currency_code: "rub",
        email: null,
      },
    })
  })
})
