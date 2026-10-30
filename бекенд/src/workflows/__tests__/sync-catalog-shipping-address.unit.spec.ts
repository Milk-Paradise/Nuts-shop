import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import {
  buildCatalogShippingAddressFields,
  prepareSyncCatalogShippingAddressUpdate,
} from "../steps/prepare-sync-catalog-shipping-address"

describe("buildCatalogShippingAddressFields", () => {
  it("builds address_1/address_2 from a full courier address", () => {
    expect(
      buildCatalogShippingAddressFields({
        city: "Москва",
        street: "Тверская",
        house: "1",
        apartment: "5",
      }),
    ).toEqual({
      city: "Москва",
      address_1: "Тверская, 1",
      address_2: "5",
    })
  })

  it("leaves address_1/address_2 undefined for a city-only (pickup) sync instead of stringifying missing fields", () => {
    expect(buildCatalogShippingAddressFields({ city: "Москва" })).toEqual({
      city: "Москва",
      address_1: undefined,
      address_2: undefined,
    })
  })

  it("treats a partial address (missing house) the same as city-only", () => {
    expect(
      buildCatalogShippingAddressFields({ city: "Москва", street: "Тверская" }),
    ).toEqual({
      city: "Москва",
      address_1: undefined,
      address_2: undefined,
    })
  })
})

describe("prepareSyncCatalogShippingAddressUpdate", () => {
  it("throws the existing INVALID_DATA error when the cart has no country", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [{ shipping_address: null, region: { countries: [] } }],
    })
    const container = {
      resolve: jest.fn().mockReturnValue({ graph }),
    } as unknown as MedusaContainer

    await expect(
      prepareSyncCatalogShippingAddressUpdate(container, {
        cart_id: "cart_1",
        city: "Москва",
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "Cart region does not include a country",
    })
  })

  it("uses the cart region country in the update passed to the cart workflow", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [{ shipping_address: null, region: { countries: [{ iso_2: "ru" }] } }],
    })
    const container = {
      resolve: jest.fn().mockReturnValue({ graph }),
    } as unknown as MedusaContainer

    await expect(
      prepareSyncCatalogShippingAddressUpdate(container, {
        cart_id: "cart_1",
        city: "Москва",
      })
    ).resolves.toEqual({
      id: "cart_1",
      shipping_address: {
        city: "Москва",
        address_1: undefined,
        address_2: undefined,
        country_code: "ru",
      },
    })
  })
})
