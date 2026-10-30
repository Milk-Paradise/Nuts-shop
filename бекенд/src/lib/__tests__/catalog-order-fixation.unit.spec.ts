import {
  catalogOrderFixationFingerprint,
  type CatalogOrderFixationInput,
} from "../catalog-order-fixation"

const input: CatalogOrderFixationInput = {
  cart_id: "cart_1",
  name: "Иван",
  phone: "+79990000000",
  email: "buyer@test.com",
  city: "Москва",
  comment: "",
}

describe("catalog order fixation identity", () => {
  beforeAll(() => {
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64")
  })

  it("uses a stable keyed fingerprint for normalized checkout input", () => {
    expect(
      catalogOrderFixationFingerprint({
        ...input,
        email: " BUYER@Test.com ",
        name: "Иван ",
      })
    ).toBe(catalogOrderFixationFingerprint(input))
  })

  it("changes identity when checkout data changes", () => {
    expect(
      catalogOrderFixationFingerprint({ ...input, phone: "+79991111111" })
    ).not.toBe(catalogOrderFixationFingerprint(input))
  })
})
