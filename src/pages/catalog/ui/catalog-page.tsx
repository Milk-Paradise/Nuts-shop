import Link from "next/link";
import { ArrowRight, Search, SlidersHorizontal, X } from "lucide-react";
import { ProductGrid } from "@/widgets/product-grid";
import { getProducts } from "@/entities/product/server";
import { filterProducts } from "@/entities/product";
import { categories } from "@/entities/category";
import { plural } from "@/shared/lib";
export type SearchParams = Record<string, string | string[] | undefined>;
const str = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";
export async function CatalogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const all = await getProducts();
  const category = str(searchParams.category),
    q = str(searchParams.q),
    brand = str(searchParams.brand),
    sort = str(searchParams.sort);
  const minString = str(searchParams.min),
    maxString = str(searchParams.max);
  const toNumber = (s: string) =>
    s && Number.isFinite(Number(s)) ? Math.max(0, Number(s)) : undefined;
  const filtered = filterProducts(all, {
    category,
    q,
    brand,
    sort,
    min: toNumber(minString),
    max: toNumber(maxString),
    inStock: str(searchParams.stock) === "1",
  });
  const perPage = 9;
  const page = Math.min(
    Math.max(1, Math.floor(Number(str(searchParams.page)) || 1)),
    Math.max(1, Math.ceil(filtered.length / perPage)),
  );
  const shown = filtered.slice((page - 1) * perPage, page * perPage);
  const pageUrl = (n: number) => {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([k, v]) => {
      if (typeof v === "string" && k !== "page") params.set(k, v);
    });
    params.set("page", String(n));
    return `/catalog?${params}`;
  };
  const title = q
    ? `Поиск: «${q}»`
    : categories.find((c) => c.id === category)?.name ||
      (brand ? `Техника ${brand}` : "Каталог техники");
  return (
    <div className="container catalog-page">
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Каталог</span>
        {category && (
          <>
            <span>/</span>
            <span>{title}</span>
          </>
        )}
      </nav>
      <div className="catalog-title">
        <div>
          <span className="eyebrow">Всё, что вам нравится</span>
          <h1>{title}</h1>
        </div>
        <span className="muted">
          {filtered.length} {plural(filtered.length)}
        </span>
      </div>
      <div className="catalog-layout">
        <aside className="catalog-sidebar">
          <form action="/catalog" className="filter-form">
            <h2>
              <SlidersHorizontal size={17} /> Фильтры
            </h2>
            <label className="filter-label" htmlFor="catalog-search">
              Поиск
            </label>
            <div className="filter-search">
              <Search size={15} />
              <input
                id="catalog-search"
                name="q"
                defaultValue={q}
                placeholder="Модель или бренд"
              />
            </div>
            <fieldset>
              <legend>Категория</legend>
              <label>
                <input
                  type="radio"
                  name="category"
                  value=""
                  defaultChecked={!category}
                />{" "}
                Все категории
              </label>
              {categories.map((c) => (
                <label key={c.id}>
                  <input
                    type="radio"
                    name="category"
                    value={c.id}
                    defaultChecked={category === c.id}
                  />
                  {c.name}
                  <span>{all.filter((p) => p.categoryId === c.id).length}</span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Бренд</legend>
              <label>
                <input
                  type="radio"
                  name="brand"
                  value=""
                  defaultChecked={!brand}
                />
                Все бренды
              </label>
              {[...new Set(all.map((p) => p.brand))].map((b) => (
                <label key={b}>
                  <input
                    type="radio"
                    name="brand"
                    value={b}
                    defaultChecked={brand === b}
                  />
                  {b}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Цена, ₽</legend>
              <div className="price-range">
                <input
                  type="number"
                  name="min"
                  min="0"
                  aria-label="Цена от"
                  placeholder="от 0"
                  defaultValue={minString}
                />
                <span>—</span>
                <input
                  type="number"
                  name="max"
                  min="0"
                  aria-label="Цена до"
                  placeholder="до 200 000"
                  defaultValue={maxString}
                />
              </div>
            </fieldset>
            <label className="filter-stock">
              <input
                type="checkbox"
                name="stock"
                value="1"
                defaultChecked={str(searchParams.stock) === "1"}
              />
              Только в наличии
            </label>
            <label className="filter-label" htmlFor="sort">
              Сначала
            </label>
            <select id="sort" name="sort" defaultValue={sort} className="input">
              <option value="">Популярные</option>
              <option value="price-asc">Недорогие</option>
              <option value="price-desc">Дорогие</option>
              <option value="name">По названию</option>
            </select>
            <button className="button button-primary w-full">
              Применить фильтры
            </button>
            <Link href="/catalog" className="reset-filter">
              <X size={14} /> Сбросить всё
            </Link>
          </form>
        </aside>
        <section className="catalog-results" aria-label="Товары каталога">
          <div className="catalog-result-heading">
            <span>
              {category
                ? categories.find((c) => c.id === category)?.name
                : "Все товары"}
            </span>
            <span className="muted">Подберите свою конфигурацию</span>
          </div>
          {shown.length ? (
            <ProductGrid products={shown} />
          ) : (
            <div className="empty-state">
              <Search size={40} strokeWidth={1} />
              <h2>Ничего не нашлось</h2>
              <p>Попробуйте другой запрос или измените фильтры.</p>
              <Link className="button button-secondary" href="/catalog">
                Сбросить фильтры <ArrowRight size={16} />
              </Link>
            </div>
          )}
          {filtered.length > perPage && (
            <nav className="pagination" aria-label="Страницы каталога">
              {Array.from(
                { length: Math.ceil(filtered.length / perPage) },
                (_, i) => (
                  <Link
                    key={i}
                    href={pageUrl(i + 1)}
                    aria-current={page === i + 1 ? "page" : undefined}
                    className={page === i + 1 ? "active" : ""}
                  >
                    {i + 1}
                  </Link>
                ),
              )}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
