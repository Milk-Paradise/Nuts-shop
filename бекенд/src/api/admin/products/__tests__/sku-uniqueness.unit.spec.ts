import {
  validateProductSkuUniqueness,
  validateVariantBatchSkuUniqueness,
  validateVariantSkuUniqueness,
} from "../sku-uniqueness"

function request(body: unknown, databaseVariants: unknown[] = [], params = {}) {
  const graph = jest.fn().mockResolvedValue({ data: databaseVariants })
  return {
    req: {
      body,
      validatedBody: body,
      params,
      scope: { resolve: jest.fn(() => ({ graph })) },
    } as any,
    graph,
    next: jest.fn(),
  }
}

describe("SKU uniqueness middleware", () => {
  it("normalizes product SKUs and allows unique values", async () => {
    const body = { variants: [{ sku: " SKU-1 " }, { sku: " " }, { title: "no sku" }] }
    const { req, graph, next } = request(body)
    await validateProductSkuUniqueness(req, {} as any, next)
    expect(body.variants[0].sku).toBe("SKU-1")
    expect(body.variants[1].sku).toBeNull()
    expect(graph).toHaveBeenCalledWith(expect.objectContaining({ filters: { sku: ["SKU-1"] } }))
    expect(next).toHaveBeenCalledWith()
  })

  it("rejects duplicates inside one product request without querying", async () => {
    const { req, graph, next } = request({ variants: [{ sku: "DUP" }, { sku: "DUP" }] })
    await validateProductSkuUniqueness(req, {} as any, next)
    expect(graph).not.toHaveBeenCalled()
    expect(next.mock.calls[0][0]).toEqual(expect.objectContaining({ message: expect.stringContaining("DUP") }))
  })

  it("rejects a SKU owned by a different stored variant", async () => {
    const { req, next } = request({ sku: "TAKEN" }, [{ id: "variant-other", sku: "TAKEN" }], { variant_id: "variant-current" })
    await validateVariantSkuUniqueness(req, {} as any, next)
    expect(next.mock.calls[0][0]).toEqual(expect.objectContaining({ message: expect.stringContaining("TAKEN") }))
  })

  it("allows an unchanged SKU on the same variant", async () => {
    const { req, next } = request({ sku: "OWN" }, [{ id: "variant-current", sku: "OWN" }], { variant_id: "variant-current" })
    await validateVariantSkuUniqueness(req, {} as any, next)
    expect(next).toHaveBeenCalledWith()
  })

  it("validates create and update batches and ignores malformed entries", async () => {
    const body = {
      create: [null, 2, { sku: null }, { sku: 7 }, { sku: "NEW" }],
      update: [{ id: "variant-1", sku: "EXISTING" }],
    }
    const { req, graph, next } = request(body, [{ id: "variant-1", sku: "EXISTING" }])
    await validateVariantBatchSkuUniqueness(req, {} as any, next)
    expect(graph).toHaveBeenCalledWith(expect.objectContaining({ filters: { sku: ["NEW", "EXISTING"] } }))
    expect(next).toHaveBeenCalledWith()
  })

  it.each([null, "body", {}, { create: "bad", update: "bad" }])("skips bodies without SKU entries", async (body) => {
    const { req, graph, next } = request(body)
    await validateVariantBatchSkuUniqueness(req, {} as any, next)
    expect(graph).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledWith()
  })
})
