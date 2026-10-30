import { describe, expect, it } from "vitest";
import { filterProducts } from "@/entities/product/lib/filter";
import { mockProducts } from "@/entities/product/api/mock";
import { themeByHour } from "@/shared/config";
import { categories } from "@/entities/category";
it("offers only Apple products and removes the Dyson category", () => {
  expect(mockProducts.length).toBeGreaterThan(0);
  expect(mockProducts.every((product) => product.brand === "Apple")).toBe(true);
  expect(categories.some((category) => category.id === "dyson")).toBe(false);
});
describe("catalog filtering", () => {
  it("combines query, category and price sort without mutating catalog", () => {
    const before = mockProducts.map((p) => p.id);
    const result = filterProducts(mockProducts, {
      q: "IPHONE",
      category: "smartphones",
      sort: "price-asc",
      max: 90000,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every((p) => p.name.includes("iPhone") && p.price <= 90000),
    ).toBe(true);
    expect(result.map((p) => p.price)).toEqual(
      result.map((p) => p.price).sort((a, b) => a - b),
    );
    expect(mockProducts.map((p) => p.id)).toEqual(before);
  });
  it("returns empty for an unknown query", () => {
    expect(
      filterProducts(mockProducts, { q: "несуществующая модель" }),
    ).toEqual([]);
  });
});
it("selects four circadian themes at exact hour boundaries", () => {
  expect([5, 6, 8, 9, 17, 18, 20, 21, 23, 0].map(themeByHour)).toEqual([
    "night",
    "dawn",
    "dawn",
    "day",
    "day",
    "dusk",
    "dusk",
    "night",
    "night",
    "night",
  ]);
});
