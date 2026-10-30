import "server-only";
import { z } from "zod";
import { mockProducts } from "./mock";
import type { Product } from "../model/types";
import { STORE_BRAND } from "@/shared/config";
import { mapMedusaProduct, medusaPageSchema } from "./medusa";
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
  const endpoint = (process.env.CATALOG_PRODUCTS_PATH || "/products").replace(
    /^\/+/,
    "",
  );
  const url = new URL(endpoint, base.endsWith("/") ? base : `${base}/`);
  if (process.env.CATALOG_API_FORMAT === "medusa") {
    if (!process.env.CATALOG_REGION_ID)
      throw new Error("Не задан CATALOG_REGION_ID Medusa.");
    url.searchParams.set("region_id", process.env.CATALOG_REGION_ID);
    url.searchParams.set(
      "fields",
      "+metadata,+categories.handle,+variants.calculated_price,+variants.inventory_quantity,+variants.options.option.title",
    );
    url.searchParams.set("limit", "100");
  }
  const products: Product[] = [];
  let offset = 0;
  do {
    if (process.env.CATALOG_API_FORMAT === "medusa")
      url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(process.env.CATALOG_PUBLISHABLE_KEY
          ? { "x-publishable-api-key": process.env.CATALOG_PUBLISHABLE_KEY }
          : {}),
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
    if (process.env.CATALOG_API_FORMAT === "medusa") {
      const page = medusaPageSchema.parse(body);
      products.push(
        ...page.products.flatMap((item) => {
          const product = mapMedusaProduct(item);
          return product ? [product] : [];
        }),
      );
      offset += page.products.length;
      if (!page.products.length || offset >= page.count) break;
    } else {
      products.push(...z.array(productSchema).parse(body));
      break;
    }
  } while (true);
  return products.filter(
    (product) =>
      product.brand.trim().toLowerCase() === STORE_BRAND.toLowerCase(),
  );
}
export async function getProduct(slug: string) {
  return (await getProducts()).find((p) => p.slug === slug);
}
