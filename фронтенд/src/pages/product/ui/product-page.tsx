import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductPurchase } from "@/widgets/product-purchase";
import { ProductGrid } from "@/widgets/product-grid";
import { getProduct, getProducts } from "@/entities/product/server";
import { categories } from "@/entities/category";
export async function ProductPage({ slug }: { slug: string }) {
  const product = await getProduct(slug);
  if (!product) notFound();
  const related = (await getProducts())
    .filter((p) => p.id !== product.id && p.categoryId === product.categoryId)
    .slice(0, 4);
  const category = categories.find((c) => c.id === product.categoryId);
  return (
    <div className="container product-page">
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link href="/">Главная</Link>
        <span>/</span>
        <Link href="/catalog">Каталог</Link>
        <span>/</span>
        <Link href={`/catalog?category=${product.categoryId}`}>
          {category?.name}
        </Link>
        <span>/</span>
        <span>{product.name}</span>
      </nav>
      <ProductPurchase product={product} />
      <div className="product-description">
        <section>
          <span className="eyebrow">Ближе к деталям</span>
          <h2>Создан для ваших планов</h2>
          <p>{product.description}</p>
        </section>
        <section>
          <h2>Характеристики</h2>
          <dl>
            {Object.entries(product.specs).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      {related.length > 0 && (
        <section className="related-section">
          <div className="section-heading">
            <h2>Вам также может понравиться</h2>
          </div>
          <ProductGrid products={related} />
        </section>
      )}
    </div>
  );
}
