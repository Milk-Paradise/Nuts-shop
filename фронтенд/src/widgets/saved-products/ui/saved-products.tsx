"use client";
import Link from "next/link";
import Image from "next/image";
import {
  Heart,
  ChartNoAxesColumnIncreasing,
  ArrowRight,
  X,
} from "lucide-react";
import { ProductCard, type Product } from "@/entities/product";
import { useFavorite } from "@/entities/favorite";
import { ToggleFavorite } from "@/features/toggle-favorite";
import { ToggleCompare } from "@/features/toggle-compare";
import { AddToCart } from "@/features/add-to-cart";
import { formatPrice } from "@/shared/lib";
export function SavedProducts({
  products,
  mode,
}: {
  products: Product[];
  mode: "favorites" | "compare";
}) {
  const ids = useFavorite((s) =>
    mode === "favorites" ? s.favorites : s.comparison,
  );
  const hydrated = useFavorite((s) => s.hydrated);
  const remove = useFavorite((s) => s.toggleCompare);
  const saved = products.filter((p) => ids.includes(p.id));
  if (!hydrated)
    return (
      <div className="empty-state" role="status">
        Загружаем подборку…
      </div>
    );
  if (!saved.length)
    return (
      <div className="empty-state">
        {mode === "favorites" ? (
          <Heart size={44} strokeWidth={1} />
        ) : (
          <ChartNoAxesColumnIncreasing size={44} strokeWidth={1} />
        )}
        <h2>
          {mode === "favorites"
            ? "Сохраните то, что нравится"
            : "Сравните перед выбором"}
        </h2>
        <p>
          {mode === "favorites"
            ? "Нажмите на сердечко в карточке товара — и он появится здесь."
            : "Добавьте товары к сравнению через значок столбиков в карточке."}
        </p>
        <Link className="button button-primary" href="/catalog">
          Выбрать товары <ArrowRight size={17} />
        </Link>
      </div>
    );
  if (mode === "favorites")
    return (
      <div className="product-grid">
        {saved.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            actions={
              <>
                <ToggleCompare id={product.id} />
                <ToggleFavorite id={product.id} />
              </>
            }
            purchase={<AddToCart product={product} compact />}
          />
        ))}
      </div>
    );
  return (
    <div className="comparison-scroll">
      <table className="comparison-table">
        <caption className="sr-only">Сравнение выбранных товаров</caption>
        <thead>
          <tr>
            <th scope="col">Характеристики</th>
            {saved.map((p) => (
              <th scope="col" key={p.id}>
                <button
                  className="icon-button"
                  aria-label={`Убрать ${p.name} из сравнения`}
                  onClick={() => remove(p.id)}
                >
                  <X size={17} />
                </button>
                <Image src={p.image} alt="" width={180} height={180} />
                <Link href={`/product/${p.slug}`}>{p.name}</Link>
                <strong>{formatPrice(p.price)}</strong>
                <AddToCart product={p} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            ["Бренд", (p: Product) => p.brand],
            ["Конфигурация", (p: Product) => p.variants[0].storage],
            [
              "Цвета",
              (p: Product) =>
                [...new Set(p.variants.map((v) => v.color))].join(", "),
            ],
            [
              "Наличие",
              (p: Product) =>
                p.variants.some((v) => v.stock > 0)
                  ? "В наличии"
                  : "Нет в наличии",
            ],
            ...[...new Set(saved.flatMap((p) => Object.keys(p.specs)))]
              .filter((key) => key !== "Бренд")
              .map((key) => [key, (p: Product) => p.specs[key] || "—"]),
          ].map(([label, getter]) => (
            <tr key={label as string}>
              <th scope="row">{label as string}</th>
              {saved.map((p) => (
                <td key={p.id}>{(getter as (p: Product) => string)(p)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
