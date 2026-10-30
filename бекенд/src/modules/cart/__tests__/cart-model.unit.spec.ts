import VersionedCart from "../models/cart"

describe("Versioned cart model", () => {
  const definition = VersionedCart.parse()

  it("maps the versioning fields to the core cart table", () => {
    const version = definition.schema.version.parse("version")
    const guestOwnerHash = definition.schema.guest_owner_hash.parse(
      "guest_owner_hash"
    )

    expect(definition).toMatchObject({
      name: "VersionedCart",
      tableName: "cart",
    })
    expect(version).toMatchObject({
      dataType: { name: "number" },
      nullable: false,
      defaultValue: 0,
    })
    expect(guestOwnerHash).toMatchObject({
      dataType: { name: "text" },
      nullable: true,
      indexes: [expect.objectContaining({ type: "unique" })],
    })
  })

  it("declares a non-unique customer lookup index", () => {
    expect(definition.indexes).toContainEqual(
      expect.objectContaining({
        name: "IDX_cart_customer_id",
        on: ["customer_id"],
        unique: false,
      })
    )
  })
})
