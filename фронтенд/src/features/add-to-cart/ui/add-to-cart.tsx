"use client";
import { useState } from "react";
import { ShoppingBag, Check } from "lucide-react";
import type { Product, ProductVariant } from "@/entities/product";
import { useCart, cartKey } from "@/entities/cart";
import { Button } from "@/shared/ui";
export function AddToCart({
  product,
  variant = product.variants[0],
  compact = false,
}: {
  product: Product;
  variant?: ProductVariant;
  compact?: boolean;
}) {
  const add = useCart((s) => s.add);
  const setOpen = useCart((s) => s.setOpen);
  const hydrated = useCart((s) => s.hydrated);
  const locked = useCart((s) => s.locked);
  const count = useCart(
    (s) =>
      s.items.find((i) => cartKey(i) === `${product.id}:${variant.id}`)
        ?.quantity ?? 0,
  );
  const [added, setAdded] = useState(false);
  const inCart = count > 0;
  return (
    <Button
      className={compact ? `cart-add ${inCart ? "is-added" : ""}` : "w-full"}
      disabled={!hydrated || locked || variant.stock <= 0}
      aria-label={
        compact
          ? `${inCart ? "Открыть корзину:" : "В корзину:"} ${product.name}`
          : undefined
      }
      onClick={() => {
        if (inCart) {
          setOpen(true);
          return;
        }
        add({
          productId: product.id,
          variantId: variant.id,
          name: product.name,
          variant: variant.label,
          price: variant.price,
          image: variant.image ?? product.image,
          slug: product.slug,
          brand: product.brand,
        });
        setAdded(true);
      }}
    >
      <span aria-hidden="true">
        {inCart || added ? <Check size={19} /> : <ShoppingBag size={19} />}
      </span>
      {!compact && (
        <span>
          {variant.stock <= 0
            ? "Нет в наличии"
            : inCart
              ? "В корзине · перейти"
              : "Добавить в корзину"}
        </span>
      )}
      <span className="sr-only" role="status">
        {added ? "Товар добавлен в корзину" : ""}
      </span>
    </Button>
  );
}
