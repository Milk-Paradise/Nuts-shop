import { AdminCatalogRefundSchema } from "../catalog-refund/validators"

it("allows an omitted amount for a full refund", () => {
  expect(AdminCatalogRefundSchema.parse({
    confirm: true,
    request_id: "00000000-0000-4000-8000-000000000001",
  })).toEqual({
    confirm: true,
    request_id: "00000000-0000-4000-8000-000000000001",
  })
})

it.each(["", "   ", null])("rejects an explicitly supplied empty amount: %p", (amount) => {
  expect(() => AdminCatalogRefundSchema.parse({ amount })).toThrow()
})

it("coerces a valid decimal amount", () => {
  expect(
    AdminCatalogRefundSchema.parse({
      amount: "125.50",
      request_id: "00000000-0000-4000-8000-000000000001",
    }).amount
  ).toBe(125.5)
})
