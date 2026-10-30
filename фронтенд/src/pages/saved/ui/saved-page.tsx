import Link from "next/link";
import { getProducts } from "@/entities/product/server";
import { SavedProducts } from "@/widgets/saved-products";
export async function SavedPage({ mode }: { mode: "favorites" | "compare" }) {
  const products = await getProducts();
  return (
    <div className="container saved-page">
      <nav className="breadcrumbs">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>{mode === "favorites" ? "Избранное" : "Сравнение"}</span>
      </nav>
      <div className="catalog-title">
        <div>
          <span className="eyebrow">Ваш личный выбор</span>
          <h1>{mode === "favorites" ? "Избранное" : "Сравнение товаров"}</h1>
        </div>
      </div>
      <SavedProducts products={products} mode={mode} />
    </div>
  );
}
