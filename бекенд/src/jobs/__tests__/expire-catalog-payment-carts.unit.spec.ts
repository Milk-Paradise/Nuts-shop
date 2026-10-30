import { config } from "../expire-catalog-payment-carts"

describe("expire catalog payment carts job", () => {
  it("runs often enough to release one-hour reservations promptly", () => {
    expect(config).toEqual({
      name: "expire-catalog-payment-carts",
      schedule: "*/5 * * * *",
    })
  })
})
