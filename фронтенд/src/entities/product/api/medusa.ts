import { z } from "zod";
import type { Product } from "../model/types";

const metadata = z.record(z.string(), z.unknown()).nullish();
const medusaProduct = z.object({
  id: z.string(),
  title: z.string(),
  handle: z.string(),
  description: z.string().nullish(),
  thumbnail: z.string().nullish(),
  metadata,
  images: z.array(z.object({ url: z.string() })).default([]),
  categories: z.array(z.object({ handle: z.string() })).default([]),
  variants: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      metadata,
      manage_inventory: z.boolean(),
      allow_backorder: z.boolean(),
      inventory_quantity: z.number().optional(),
      calculated_price: z
        .object({ calculated_amount: z.number().nonnegative() })
        .nullish(),
      options: z
        .array(
          z.object({
            value: z.string(),
            option: z.object({ title: z.string() }).optional(),
          }),
        )
        .default([]),
    }),
  ),
});
export const medusaPageSchema = z.object({
  products: z.array(medusaProduct),
  count: z.number().int().nonnegative(),
});

export function mapMedusaProduct(
  source: z.infer<typeof medusaProduct>,
): Product | null {
  const meta = source.metadata ?? {};
  const image =
    source.thumbnail || source.images[0]?.url || "/images/accessory.png";
  const variants = source.variants.flatMap((variant) => {
    if (!variant.calculated_price) return [];
    const options = Object.fromEntries(
      variant.options.map((item) => [
        item.option?.title.toLowerCase() ?? "",
        item.value,
      ]),
    );
    const color = options["цвет"] || options.color || "Стандартный";
    return [
      {
        id: variant.id,
        label: variant.title,
        color,
        colorHex:
          typeof variant.metadata?.colorHex === "string"
            ? variant.metadata.colorHex
            : "#85858a",
        storage:
          options["память"] ||
          options.storage ||
          options["конфигурация"] ||
          variant.title,
        price: variant.calculated_price.calculated_amount,
        stock:
          !variant.manage_inventory || variant.allow_backorder
            ? 999
            : Math.max(0, Math.floor(variant.inventory_quantity ?? 0)),
        image,
      },
    ];
  });
  if (!variants.length) return null;
  const specs = z
    .record(z.string(), z.string())
    .safeParse(meta.characteristics);
  return {
    id: source.id,
    slug: source.handle,
    name: source.title,
    brand: typeof meta.brand === "string" ? meta.brand : "",
    categoryId:
      typeof meta.categoryId === "string"
        ? meta.categoryId
        : (source.categories[0]?.handle ?? "accessories"),
    description: source.description ?? "",
    image,
    images: source.images.length
      ? source.images.map((item) => item.url)
      : [image],
    price: Math.min(...variants.map((variant) => variant.price)),
    rating: typeof meta.rating === "number" ? meta.rating : 0,
    reviewCount: typeof meta.reviewCount === "number" ? meta.reviewCount : 0,
    specs: specs.success ? specs.data : {},
    variants,
  };
}
