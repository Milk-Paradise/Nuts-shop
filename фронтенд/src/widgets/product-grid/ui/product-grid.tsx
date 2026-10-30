import { ProductCard, type Product } from "@/entities/product";
import { AddToCart } from "@/features/add-to-cart";
import { ToggleFavorite } from "@/features/toggle-favorite";
import { ToggleCompare } from "@/features/toggle-compare";
import { Reveal } from "@/shared/ui";
export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="product-grid">
      {products.map((product, index) => (
        <Reveal key={product.id} delay={Math.min((index % 4) * 0.045, 0.14)}>
          <ProductCard
            product={product}
            actions={
              <>
                <ToggleCompare id={product.id} />
                <ToggleFavorite id={product.id} />
              </>
            }
            purchase={<AddToCart product={product} compact />}
          />
        </Reveal>
      ))}
    </div>
  );
}
