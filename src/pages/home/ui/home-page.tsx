import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  Truck,
  MessagesSquare,
  BadgeCheck,
  Sparkles,
} from "lucide-react";
import { Hero } from "@/widgets/hero";
import { ProductGrid } from "@/widgets/product-grid";
import { getProducts } from "@/entities/product/server";
import { categories } from "@/entities/category";
import { STORE_EMAIL } from "@/shared/config";
export async function HomePage({ category }: { category?: string }) {
  const products = await getProducts();
  const selected = category
    ? products.filter((p) => p.categoryId === category)
    : products;
  return (
    <div className="container home-page">
      <div className="home-intro">
        <span>Технологии для жизни. И немного больше.</span>
        <span className="intro-right">
          <span className="stock-dot" /> Ваш следующий любимый гаджет — здесь
        </span>
      </div>
      <Hero />
      <section className="benefit-strip" aria-label="Сервис магазина">
        {[
          [BadgeCheck, "Внимание к качеству", "Проверяем перед выдачей"],
          [Truck, "Как вам удобно", "Доставка или самовывоз"],
          [ShieldCheck, "Поможем разобраться", "С выбором и после покупки"],
          [MessagesSquare, "На связи с вами", "Без роботов и сложных меню"],
        ].map(([Icon, title, text]) => {
          const I = Icon as typeof BadgeCheck;
          return (
            <div key={title as string}>
              <I size={25} strokeWidth={1.4} />
              <span>
                <strong>{title as string}</strong>
                <small>{text as string}</small>
              </span>
            </div>
          );
        })}
      </section>
      <section className="category-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Найдите своё</span>
            <h2>Что вас интересует?</h2>
          </div>
          <Link href="/catalog" className="text-link">
            Весь каталог <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="category-grid">
          {categories.map((c) => (
            <Link
              className="category-card"
              href={`/catalog?category=${c.id}`}
              key={c.id}
            >
              <div className="category-image">
                <Image
                  src={c.image}
                  alt=""
                  fill
                  sizes="(max-width: 600px) 28vw, 12vw"
                />
              </div>
              <span>{c.shortName}</span>
              <ArrowUpRight className="category-card-arrow" size={14} />
            </Link>
          ))}
        </div>
      </section>
      <section className="popular-section" id="popular">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Хороший выбор начинается здесь</span>
            <h2>
              В центре внимания{" "}
              <span className="heading-spark">
                <Sparkles size={24} />
              </span>
            </h2>
          </div>
          <Link href="/catalog" className="text-link">
            Смотреть все <ArrowRight size={17} />
          </Link>
        </div>
        <nav className="product-tabs" aria-label="Подборки товаров">
          {[
            { id: "", name: "Популярное" },
            ...categories
              .filter((c) =>
                ["smartphones", "laptops", "headphones", "tablets"].includes(
                  c.id,
                ),
              )
              .map((c) => ({ id: c.id, name: c.shortName })),
          ].map((c) => (
            <Link
              key={c.id}
              href={c.id ? `/?category=${c.id}#popular` : "/#popular"}
              className={
                (!category && !c.id) || category === c.id ? "active" : ""
              }
              scroll={false}
            >
              {c.name}
            </Link>
          ))}
        </nav>
        <ProductGrid products={selected.slice(0, 8)} />
        {!selected.length && (
          <div className="empty-state">
            <h3>Скоро здесь появятся товары</h3>
            <Link href="/catalog">Открыть весь каталог</Link>
          </div>
        )}
      </section>
      <section className="help-section">
        <div>
          <span className="eyebrow">Давайте найдём то самое</span>
          <h2>
            Выбирать проще,
            <br />
            когда есть с кем посоветоваться.
          </h2>
          <p>
            Расскажите, что важно для вас.
            <br />
            Мы поможем разобраться в моделях и конфигурациях.
          </p>
        </div>
        <a href={`mailto:${STORE_EMAIL}`} className="help-contact">
          <span className="help-icon">
            <MessagesSquare size={28} />
          </span>
          <span>
            <small>Поможем с вашим выбором</small>
            <strong>{STORE_EMAIL}</strong>
            <span>
              Написать нам <ArrowUpRight size={15} />
            </span>
          </span>
        </a>
      </section>
    </div>
  );
}
