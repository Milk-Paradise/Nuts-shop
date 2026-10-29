import type { Product, CatalogFilters } from "../model/types";
export function filterProducts(products: Product[], filters: CatalogFilters) {
  const q = filters.q?.trim().toLocaleLowerCase("ru-RU");
  const result = products.filter(
    (p) =>
      (!filters.category || p.categoryId === filters.category) &&
      (!filters.brand || p.brand === filters.brand) &&
      (!q ||
        `${p.name} ${p.description}`.toLocaleLowerCase("ru-RU").includes(q)) &&
      (filters.min === undefined || p.price >= filters.min) &&
      (filters.max === undefined || p.price <= filters.max) &&
      (!filters.inStock || p.variants.some((v) => v.stock > 0)),
  );
  if (filters.sort === "price-asc") result.sort((a, b) => a.price - b.price);
  if (filters.sort === "price-desc") result.sort((a, b) => b.price - a.price);
  if (filters.sort === "name")
    result.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return result;
}
