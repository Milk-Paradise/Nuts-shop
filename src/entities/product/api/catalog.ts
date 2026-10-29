import "server-only";
import { z } from "zod";
import { mockProducts } from "./mock";
import type { Product } from "../model/types";
import { STORE_BRAND } from "@/shared/config";
const variantSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
  colorHex: z.string(),
  storage: z.string(),
  price: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
  image: z.string().optional(),
});
const productSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  categoryId: z.string(),
  description: z.string(),
  image: z.string(),
  images: z.array(z.string()),
  price: z.number().nonnegative(),
  rating: z.number(),
  reviewCount: z.number(),
  badge: z.string().optional(),
  specs: z.record(z.string(), z.string()),
  variants: z.array(variantSchema).min(1),
});
export const isMockCatalog = () => process.env.USE_MOCK !== "false";
export async function getProducts(): Promise<Product[]> {
  if (isMockCatalog()) return mockProducts;
  const base = process.env.CATALOG_API_URL;
  if (!base)
    throw new Error(
      "Не задан CATALOG_API_URL. Для демонстрации включите USE_MOCK=true.",
    );
  // TODO: replace the endpoint and DTO mapping after the deployed catalog API is documented.
  // Supplied GitLab URL is a repository/login page, not a verified catalog endpoint.
  const endpoint = (process.env.CATALOG_PRODUCTS_PATH || "/products").replace(
    /^\/+/,
    "",
  );
  const url = new URL(endpoint, base.endsWith("/") ? base : `${base}/`);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(process.env.CATALOG_API_TOKEN
        ? { Authorization: `Bearer ${process.env.CATALOG_API_TOKEN}` }
        : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Каталог временно недоступен (${response.status}).`);
  const body: unknown = await response.json();
  return z
    .array(productSchema)
    .parse(body)
    .filter(
      (product) =>
        product.brand.trim().toLowerCase() === STORE_BRAND.toLowerCase(),
    );
}
export async function getProduct(slug: string) {
  return (await getProducts()).find((p) => p.slug === slug);
}
