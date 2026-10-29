import type { OrderInput } from "./schema";
// Structural catalog input keeps entity slices independent (no product → order cross-import).
interface CatalogProduct {
  id: string;
  name: string;
  variants: { id: string; label: string; price: number; stock: number }[];
}
export function buildOrder(input: OrderInput, products: CatalogProduct[]) {
  const items = input.items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    const variant = product?.variants.find((v) => v.id === item.variantId);
    if (!product || !variant)
      throw new Error("Товар больше недоступен. Обновите корзину.");
    if (variant.stock < item.quantity)
      throw new Error(
        `Недостаточно товара «${product.name}». Доступно: ${variant.stock}.`,
      );
    return {
      ...item,
      name: product.name,
      variant: variant.label,
      price: variant.price,
      subtotal: variant.price * item.quantity,
    };
  });
  return {
    ...input,
    items,
    total: items.reduce((sum, item) => sum + item.subtotal, 0),
  };
}
