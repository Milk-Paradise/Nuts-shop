"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Search,
  MapPin,
  ArrowUpRight,
  Heart,
  ShoppingBag,
  ChartNoAxesColumnIncreasing,
  Menu,
  ChevronDown,
  Mail,
  Grid2X2,
} from "lucide-react";
import { useCart, selectCartCount } from "@/entities/cart";
import { useFavorite } from "@/entities/favorite";
import { categories } from "@/entities/category";
import { SwitchTheme } from "@/features/switch-theme";
import { Modal, Wordmark } from "@/shared/ui";
import { SITE_NAME, STORE_EMAIL } from "@/shared/config";
export function Header() {
  const cartCount = useCart(selectCartCount);
  const openCart = useCart((s) => s.setOpen);
  const favorites = useFavorite((s) => s.favorites.length);
  const comparison = useFavorite((s) => s.comparison.length);
  const [menu, setMenu] = useState(false);
  const path = usePathname();
  return (
    <header className="site-header">
      <div className="utility-bar">
        <div className="container utility-inner">
          <span className="location">
            <MapPin size={13} /> Москва <ChevronDown size={11} />
          </span>
          <nav aria-label="Информация">
            <Link href="/info/delivery">Доставка и оплата</Link>
            <Link href="/info/warranty">Гарантия</Link>
            <Link href="/info/contacts">Контакты</Link>
          </nav>
          <a className="utility-email" href={`mailto:${STORE_EMAIL}`}>
            {STORE_EMAIL} <span>Напишите нам</span>
          </a>
        </div>
      </div>
      <div className="container main-header">
        <Link href="/" className="logo" aria-label={`${SITE_NAME} — главная`}>
          <Wordmark />
        </Link>
        <Link href="/catalog" className="catalog-button">
          <Grid2X2 size={18} /> Каталог
        </Link>
        <form className="search-form" action="/catalog" role="search">
          <Search size={19} />
          <input
            type="search"
            name="q"
            placeholder="Найти то самое"
            aria-label="Поиск по каталогу"
          />
          <kbd>↵</kbd>
        </form>
        <div className="header-actions">
          <SwitchTheme />
          <Link
            href="/compare"
            className={`header-action ${path === "/compare" ? "selected" : ""}`}
            aria-label={`Сравнение: ${comparison}`}
          >
            <span className="counter-icon">
              <ChartNoAxesColumnIncreasing size={22} />
              {comparison > 0 && <b>{comparison}</b>}
            </span>
            <span className="action-label">Сравнение</span>
          </Link>
          <Link
            href="/favorites"
            className={`header-action ${path === "/favorites" ? "selected" : ""}`}
            aria-label={`Избранное: ${favorites}`}
          >
            <span className="counter-icon">
              <Heart size={22} />
              {favorites > 0 && <b>{favorites}</b>}
            </span>
            <span className="action-label">Избранное</span>
          </Link>
          <button
            className="header-action"
            aria-label={`Корзина: ${cartCount}`}
            onClick={() => openCart(true)}
          >
            <span className="counter-icon">
              <ShoppingBag size={22} />
              {cartCount > 0 && <b>{cartCount}</b>}
            </span>
            <span className="action-label">Корзина</span>
          </button>
          <button
            className="icon-button mobile-menu"
            aria-label="Открыть меню"
            onClick={() => setMenu(true)}
          >
            <Menu />
          </button>
        </div>
      </div>
      <div className="category-nav-wrap">
        <nav className="container category-nav" aria-label="Категории товаров">
          {categories.map((c) => (
            <Link key={c.id} href={`/catalog?category=${c.id}`}>
              {c.shortName}
            </Link>
          ))}
          <Link href="/catalog?brand=Apple" className="brand-nav">
            Всё Apple <ArrowUpRight size={14} />
          </Link>
        </nav>
      </div>
      <Modal title="Меню" open={menu} onClose={() => setMenu(false)} drawer>
        <nav className="mobile-nav">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/catalog?category=${c.id}`}
              onClick={() => setMenu(false)}
            >
              {c.name}
              <ArrowUpRight size={18} />
            </Link>
          ))}
          <Link href="/favorites" onClick={() => setMenu(false)}>
            Избранное <Heart size={18} />
          </Link>
          <Link href="/compare" onClick={() => setMenu(false)}>
            Сравнение <ChartNoAxesColumnIncreasing size={18} />
          </Link>
          <a href={`mailto:${STORE_EMAIL}`}>
            <Mail size={18} /> {STORE_EMAIL}
          </a>
        </nav>
      </Modal>
    </header>
  );
}
