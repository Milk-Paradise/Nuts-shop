import {
  catalogOrderFixationFingerprint,
} from "../../../lib/catalog-order-fixation"
import {
  claimCatalogOrderFixation,
  prepareCatalogOrderFixation,
} from "../catalog-order-fixation"

const input = {
  cart_id: "cart_1",
  customer_id: "cus_1",
  name: "Иван",
  phone: "+79990000000",
  email: "buyer@test.com",
  city: "Москва",
  comment: "",
}

function setup(
  records: Array<Record<string, unknown>> = [],
  relatedOrderId: string | null = null
) {
  const service = {
    listOrderFixations: jest.fn(async () => records),
    createOrderFixations: jest.fn(async (record) => ({ id: "fixation_1", ...record })),
    updateOrderFixations: jest.fn(async (record) => record),
  }
  const query = {
    graph: jest.fn(async () => ({
      data: relatedOrderId ? [{ order_id: relatedOrderId, cart_id: input.cart_id }] : [],
    })),
  }
  const container = {
    resolve: jest.fn((key: string) =>
      key === "orderFixation" ? service : query
    ),
  } as any

  return { container, service, query }
}

beforeAll(() => {
  process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64")
})

it("leaves no fixation record when this cart has not been claimed", async () => {
  const { container } = setup()

  await expect(prepareCatalogOrderFixation(container, input)).resolves.toEqual({
    fixation_id: null,
    order_id: null,
  })
})

it("returns the linked order for an identical request", async () => {
  const { container } = setup([{
    id: "fixation_1",
    cart_id: input.cart_id,
    request_fingerprint: catalogOrderFixationFingerprint(input),
    order_id: "order_1",
  }])

  await expect(prepareCatalogOrderFixation(container, input)).resolves.toEqual({
    fixation_id: "fixation_1",
    order_id: "order_1",
  })
})

it("rejects changed checkout data for a claimed cart", async () => {
  const { container } = setup([{
    id: "fixation_1",
    cart_id: input.cart_id,
    request_fingerprint: "another-fingerprint",
    order_id: null,
  }])

  await expect(prepareCatalogOrderFixation(container, input)).rejects.toMatchObject({
    name: "CatalogOrderFixationConflictError",
  })
})

it("recovers the order-cart link if the order was created before its fixation was updated", async () => {
  const { container, service } = setup([{
    id: "fixation_1",
    cart_id: input.cart_id,
    request_fingerprint: catalogOrderFixationFingerprint(input),
    order_id: null,
  }], "order_recovered")

  await expect(prepareCatalogOrderFixation(container, input)).resolves.toEqual({
    fixation_id: "fixation_1",
    order_id: "order_recovered",
  })
  expect(service.updateOrderFixations).toHaveBeenCalledWith({
    id: "fixation_1",
    order_id: "order_recovered",
  })
})

it("claims a fixation before side effects and resolves a concurrent claim", async () => {
  const { container, service } = setup()
  await expect(claimCatalogOrderFixation(container, input)).resolves.toEqual({
    fixation_id: "fixation_1",
  })
  expect(service.createOrderFixations).toHaveBeenCalledWith({
    cart_id: input.cart_id,
    request_fingerprint: expect.any(String),
    order_id: null,
  })

  const fingerprint = catalogOrderFixationFingerprint(input)
  const concurrent = setup([{
    id: "fixation_2",
    cart_id: input.cart_id,
    request_fingerprint: fingerprint,
    order_id: "order_2",
  }])
  concurrent.service.createOrderFixations.mockRejectedValueOnce(new Error("unique constraint"))
  concurrent.service.listOrderFixations
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{
      id: "fixation_2",
      cart_id: input.cart_id,
      request_fingerprint: fingerprint,
      order_id: "order_2",
    }])

  await expect(claimCatalogOrderFixation(concurrent.container, input)).resolves.toEqual({
    fixation_id: "fixation_2",
  })
})
