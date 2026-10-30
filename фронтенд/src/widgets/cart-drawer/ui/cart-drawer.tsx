"use client";
import Link from "next/link";
import Image from "next/image";
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight } from "lucide-react";
import { useCart, selectCartTotal, cartKey } from "@/entities/cart";
import { formatPrice } from "@/shared/lib";
import { Modal, Notice } from "@/shared/ui";
export function CartDrawer() {
  const open = useCart((s) => s.open),
    setOpen = useCart((s) => s.setOpen),
    items = useCart((s) => s.items),
    locked = useCart((s) => s.locked),
    total = useCart(selectCartTotal),
    remove = useCart((s) => s.remove),
    setQuantity = useCart((s) => s.setQuantity);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={`Корзина${items.length ? ` · ${items.reduce((n, i) => n + i.quantity, 0)}` : ""}`}
      drawer
    >
      {locked && (
        <Notice>
          Отправляем заявку. Количество товаров можно будет изменить после
          ответа сервера.
        </Notice>
      )}
      {!items.length ? (
        <div className="empty-state drawer-empty">
          <ShoppingBag size={46} strokeWidth={1} />
          <h3>Здесь будет ваша техника</h3>
          <p>Добавьте что-нибудь из каталога.</p>
          <Link
            href="/catalog"
            className="button button-primary"
            onClick={() => setOpen(false)}
          >
            Выбрать товары <ArrowRight size={17} />
          </Link>
        </div>
      ) : (
        <>
          <div className="cart-items">
            {items.map((item) => (
              <article className="cart-item" key={cartKey(item)}>
                <Link
                  href={`/product/${item.slug}`}
                  onClick={() => setOpen(false)}
                  className="cart-image"
                >
                  <Image
                    src={item.image}
                    alt={item.name}
                    width={88}
                    height={100}
                  />
                </Link>
                <div className="cart-item-content">
                  <Link
                    href={`/product/${item.slug}`}
                    onClick={() => setOpen(false)}
                  >
                    {item.name}
                  </Link>
                  <p>{item.variant}</p>
                  <strong>{formatPrice(item.price * item.quantity)}</strong>
                  <div className="cart-controls">
                    <div className="quantity">
                      <button
                        onClick={() =>
                          setQuantity(cartKey(item), item.quantity - 1)
                        }
                        disabled={locked || item.quantity <= 1}
                        aria-label={`Уменьшить количество ${item.name}`}
                      >
                        <Minus size={14} />
                      </button>
                      <span aria-live="polite">{item.quantity}</span>
                      <button
                        onClick={() =>
                          setQuantity(cartKey(item), item.quantity + 1)
                        }
                        disabled={locked || item.quantity >= 99}
                        aria-label={`Увеличить количество ${item.name}`}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <button
                      className="icon-button remove-button"
                      disabled={locked}
                      onClick={() => remove(cartKey(item))}
                      aria-label={`Удалить ${item.name}`}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="cart-footer">
            <div>
              <span>Итого за товары</span>
              <strong>{formatPrice(total)}</strong>
            </div>
            <p>Стоимость доставки уточним при подтверждении.</p>
            <Link
              href="/checkout"
              className="button button-primary w-full"
              onClick={() => setOpen(false)}
            >
              Оформить заказ <ArrowRight size={18} />
            </Link>
            <button
              className="continue-shopping"
              onClick={() => setOpen(false)}
            >
              Продолжить покупки
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
