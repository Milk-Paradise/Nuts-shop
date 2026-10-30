import {
  computeAvailability,
  productAvailability,
  variantAvailability,
  variantAvailableQuantity,
  type AvailabilityVariant,
} from "../availability"

function variant(overrides: Partial<AvailabilityVariant> = {}): AvailabilityVariant {
  return {
    manage_inventory: true,
    allow_backorder: false,
    inventory_items: [],
    ...overrides,
  }
}

function inventoryItems(
  levels: { stocked: number | string; reserved?: number | string }[],
  requiredQuantity: number | string = 1
) {
  return [
    {
      required_quantity: requiredQuantity,
      inventory: {
        location_levels: levels.map((level) => ({
          stocked_quantity: level.stocked,
          reserved_quantity: level.reserved ?? 0,
        })),
      },
    },
  ]
}

describe("computeAvailability", () => {
  it("returns in_stock when available quantity is positive", () => {
    expect(computeAvailability(1, false)).toBe("in_stock")
    expect(computeAvailability(1, true)).toBe("in_stock")
  })

  it("returns backorder when quantity is zero and backorder is allowed", () => {
    expect(computeAvailability(0, true)).toBe("backorder")
  })

  it("returns out_of_stock when quantity is zero and backorder is not allowed", () => {
    expect(computeAvailability(0, false)).toBe("out_of_stock")
  })

  it("treats negative quantity as unavailable", () => {
    expect(computeAvailability(-3, false)).toBe("out_of_stock")
    expect(computeAvailability(-3, true)).toBe("backorder")
  })
})

describe("variantAvailableQuantity", () => {
  it("sums stocked minus reserved across locations", () => {
    expect(
      variantAvailableQuantity(
        variant({
          inventory_items: inventoryItems([
            { stocked: 4, reserved: 1 },
            { stocked: 2 },
          ]),
        })
      )
    ).toBe(5)
  })

  it("returns zero when there are no inventory items", () => {
    expect(variantAvailableQuantity(variant())).toBe(0)
  })

  it("coerces string quantities and ignores non-numeric values", () => {
    expect(
      variantAvailableQuantity(
        variant({
          inventory_items: inventoryItems([
            { stocked: "7", reserved: "2" },
            { stocked: "not-a-number" },
          ]),
        })
      )
    ).toBe(5)
  })

  it("divides by required quantity per unit", () => {
    const items = inventoryItems([{ stocked: 5 }], 2)

    expect(variantAvailableQuantity(variant({ inventory_items: items }))).toBe(2)
  })

  it("uses the most constrained inventory item", () => {
    const items = [
      ...inventoryItems([{ stocked: 10 }]),
      ...inventoryItems([{ stocked: 1 }]),
    ]

    expect(variantAvailableQuantity(variant({ inventory_items: items }))).toBe(1)
  })
})

describe("variantAvailability", () => {
  it("returns in_stock when there is available stock", () => {
    expect(
      variantAvailability(
        variant({ inventory_items: inventoryItems([{ stocked: 3 }]) })
      )
    ).toBe("in_stock")
  })

  it("returns backorder for zero stock with backorder allowed", () => {
    expect(
      variantAvailability(
        variant({
          allow_backorder: true,
          inventory_items: inventoryItems([{ stocked: 0 }]),
        })
      )
    ).toBe("backorder")
  })

  it("returns out_of_stock for zero stock without backorder", () => {
    expect(
      variantAvailability(
        variant({ inventory_items: inventoryItems([{ stocked: 0 }]) })
      )
    ).toBe("out_of_stock")
  })

  it("treats fully reserved stock as unavailable", () => {
    expect(
      variantAvailability(
        variant({
          inventory_items: inventoryItems([{ stocked: 3, reserved: 3 }]),
        })
      )
    ).toBe("out_of_stock")
  })

  it("returns in_stock when inventory is not managed", () => {
    expect(
      variantAvailability(variant({ manage_inventory: false }))
    ).toBe("in_stock")
  })
})

describe("productAvailability", () => {
  it("returns the best status across variants", () => {
    expect(
      productAvailability([
        variant({ inventory_items: inventoryItems([{ stocked: 0 }]) }),
        variant({
          allow_backorder: true,
          inventory_items: inventoryItems([{ stocked: 0 }]),
        }),
      ])
    ).toBe("backorder")

    expect(
      productAvailability([
        variant({ inventory_items: inventoryItems([{ stocked: 0 }]) }),
        variant({ inventory_items: inventoryItems([{ stocked: 2 }]) }),
      ])
    ).toBe("in_stock")
  })

  it("returns out_of_stock when there are no variants", () => {
    expect(productAvailability([])).toBe("out_of_stock")
    expect(productAvailability(null)).toBe("out_of_stock")
  })
})
