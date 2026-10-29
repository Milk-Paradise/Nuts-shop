"use client";
import Image from "next/image";
import { useState } from "react";
import { Star, Truck, ShieldCheck, PackageCheck } from "lucide-react";
import type { Product } from "@/entities/product";
import { AddToCart } from "@/features/add-to-cart";
import { ToggleFavorite } from "@/features/toggle-favorite";
import { ToggleCompare } from "@/features/toggle-compare";
import { formatPrice } from "@/shared/lib";
export function ProductPurchase({ product }: { product: Product }) {
  const [variant, setVariant] = useState(product.variants[0]);
  const colors = [...new Set(product.variants.map((v) => v.color))],
    storages = [...new Set(product.variants.map((v) => v.storage))];
  return (
    <div className="product-detail">
      <div className="detail-gallery">
        <span className="detail-brand">{product.brand}</span>
        <Image
          src={variant.image ?? product.image}
          alt={`${product.name}, ${variant.color}`}
          fill
          sizes={
            product.image.includes("iphone")
              ? "(max-width: 800px) 200vw, 120vw"
              : "(max-width: 800px) 90vw, 50vw"
          }
          priority
        />
        <div className="gallery-caption">
          Изображение модели. Цвет выбранной конфигурации уточнит менеджер.
        </div>
      </div>
      <div className="detail-info">
        <div className="detail-topline">
          <span className="badge">{product.badge || product.brand}</span>
          <div className="card-actions">
            <ToggleCompare id={product.id} />
            <ToggleFavorite id={product.id} />
          </div>
        </div>
        <h1>{product.name}</h1>
        <div className="detail-rating">
          <Star size={15} fill="currentColor" /> {product.rating}
          <span>·</span>
          <span className="stock-text">
            <span className="stock-dot" />
            {variant.stock > 0 ? "В наличии" : "Нет в наличии"}
          </span>
        </div>
        <div className="variant-section">
          <h3>
            Цвет: <span>{variant.color}</span>
          </h3>
          <div className="color-options">
            {colors.map((color) => {
              const v =
                product.variants.find(
                  (v) => v.color === color && v.storage === variant.storage,
                ) ?? product.variants.find((v) => v.color === color)!;
              return (
                <button
                  key={color}
                  className={variant.color === color ? "active" : ""}
                  aria-label={color}
                  aria-pressed={variant.color === color}
                  title={color}
                  onClick={() => setVariant(v)}
                >
                  <span style={{ background: v.colorHex }} />
                </button>
              );
            })}
          </div>
        </div>
        <div className="variant-section">
          <h3>
            {product.categoryId === "smartphones" ||
            product.categoryId === "tablets" ||
            product.categoryId === "laptops"
              ? "Память"
              : "Конфигурация"}
          </h3>
          <div className="storage-options">
            {storages.map((storage) => {
              const v = product.variants.find(
                (v) => v.storage === storage && v.color === variant.color,
              );
              return (
                <button
                  key={storage}
                  className={storage === variant.storage ? "active" : ""}
                  disabled={!v}
                  aria-pressed={storage === variant.storage}
                  onClick={() => v && setVariant(v)}
                >
                  {storage}
                </button>
              );
            })}
          </div>
        </div>
        <div className="detail-price">
          <strong>{formatPrice(variant.price)}</strong>
        </div>
        <p className="muted detail-price-note">
          Итоговую стоимость подтвердит менеджер
        </p>
        <AddToCart product={product} variant={variant} />
        <div className="detail-benefits">
          <span>
            <Truck size={19} />
            <span>
              <strong>Доставка и самовывоз</strong>
              <small>Удобный способ получения</small>
            </span>
          </span>
          <span>
            <ShieldCheck size={19} />
            <span>
              <strong>Поддержка после покупки</strong>
              <small>Условия гарантии уточнит менеджер</small>
            </span>
          </span>
          <span>
            <PackageCheck size={19} />
            <span>
              <strong>Внимание к деталям</strong>
              <small>Проверим комплектацию перед выдачей</small>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
