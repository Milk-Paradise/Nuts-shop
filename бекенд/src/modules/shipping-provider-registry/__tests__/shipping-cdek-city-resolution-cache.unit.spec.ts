import { normalizeCdekCacheKey } from "../models/shipping-cdek-city-resolution-cache"

describe("normalizeCdekCacheKey", () => {
  it("normalizes city lookup keys and represents missing qualifiers as empty strings", () => {
    expect(normalizeCdekCacheKey({
      country_code: " ru ",
      city: "  Нижний\n Новгород ",
      region: " Нижегородская\t область ",
      postal_code: " 603000 ",
    })).toEqual({
      country_code: "RU",
      city: "нижний новгород",
      region: "нижегородская область",
      postal_code: "603000",
    })

    expect(normalizeCdekCacheKey({
      country_code: "kz",
      city: " Алматы ",
    })).toEqual({
      country_code: "KZ",
      city: "алматы",
      region: "",
      postal_code: "",
    })
  })
})
