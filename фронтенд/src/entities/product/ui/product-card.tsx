import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { formatPrice } from "@/shared/lib";
import type { Product } from "../model/types";
export function ProductCard({
  product,
  actions,
  purchase,
}: {
  product: Product;
  actions?: ReactNode;
  purchase?: ReactNode;
}) {
  const available = product.variants[0].stock > 0;
  return (
    <article className="product-card">
      <div className="product-card-top">
        {product.badge ? (
          <span
            className={`badge ${product.badge === "Новинка" ? "badge-blue" : ""}`}
          >
            {product.badge}
          </span>
        ) : (
          <span />
        )}
        <div className="card-actions">{actions}</div>
      </div>
      <Link
        className="product-image"
        href={`/product/${product.slug}`}
        tabIndex={-1}
        aria-hidden="true"
      >
        <Image
          src={product.image}
          alt=""
          fill
          sizes={
            product.image.includes("iphone")
              ? "(max-width: 600px) 120vw, 65vw"
              : "(max-width: 600px) 45vw, 24vw"
          }
        />
      </Link>
      <div className="product-meta">
        <span
          className="stock-dot"
          style={{ background: available ? "var(--success)" : "var(--muted)" }}
        />
        {available ? "В наличии" : "Нет в наличии"}{" "}
        <span className="rating">
          <Star size={12} fill="currentColor" /> {product.rating}
        </span>
      </div>
      <Link className="product-name" href={`/product/${product.slug}`}>
        {product.name}
      </Link>
      <p className="product-configuration">
        {product.variants[0].storage} · {product.variants[0].color}
      </p>
      <div className="color-dots">
        {Array.from(
          new Map(product.variants.map((v) => [v.color, v])).values(),
        ).map((v) => (
          <span
            key={v.color}
            title={v.color}
            style={{ background: v.colorHex }}
          />
        ))}
      </div>
      <div className="product-bottom">
        <div>
          <strong className="price">{formatPrice(product.price)}</strong>
        </div>
        {purchase}
      </div>
    </article>
  );
}
