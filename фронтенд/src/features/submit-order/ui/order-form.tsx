"use client";
import Link from "next/link";
import Image from "next/image";
import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  MapPin,
  Truck,
  ShieldCheck,
  LoaderCircle,
} from "lucide-react";
import { useCart, selectCartTotal, cartKey } from "@/entities/cart";
import {
  orderSchema,
  readOrderAttempt,
  writeOrderAttempt,
  clearOrderAttempt,
} from "@/entities/order";
import { formatPrice } from "@/shared/lib";
import { STORE_EMAIL } from "@/shared/config";
import { Button, Input, Notice } from "@/shared/ui";
type Fields = {
  name: string;
  phone: string;
  email: string;
  address: string;
  comment: string;
};
export function OrderForm() {
  const items = useCart((s) => s.items);
  const hydrated = useCart((s) => s.hydrated);
  const total = useCart(selectCartTotal);
  const clear = useCart((s) => s.clear);
  const locked = useCart((s) => s.locked);
  const setLocked = useCart((s) => s.setLocked);
  const [attemptReady, setAttemptReady] = useState(false);
  const [values, setValues] = useState<Fields>({
    name: "",
    phone: "",
    email: "",
    address: "",
    comment: "",
  });
  const [delivery, setDelivery] = useState<"delivery" | "pickup">("delivery");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<
    "idle" | "pending" | "success" | "uncertain"
  >("idle");
  const [error, setError] = useState("");
  const [orderId, setOrderId] = useState("");
  const busy = useRef(false);
  const requestId = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const restore = () => {
      try {
        const attempt = readOrderAttempt(localStorage);
        if (attempt) {
          requestId.current = attempt.key;
          setStatus("uncertain");
          setError(
            "У предыдущей заявки нет подтверждения доставки. Она могла дойти. Свяжитесь с магазином перед повторной отправкой.",
          );
        }
      } catch {
        /* Sending still requires a successful persistence write below. */
      }
      setAttemptReady(true);
    };
    restore();
    window.addEventListener("storage", restore);
    return () => window.removeEventListener("storage", restore);
  }, []);
  if (status === "success")
    return (
      <div className="success-state">
        <span className="success-icon">
          <Check size={36} />
        </span>
        <span className="eyebrow">Спасибо за ваш выбор</span>
        <h1>Заявка отправлена</h1>
        <p>
          Номер заявки: <strong>{orderId}</strong>
          <br />
          Менеджер свяжется с вами, чтобы подтвердить наличие и условия
          получения.
        </p>
        <Link className="button button-primary" href="/catalog">
          Продолжить покупки <ArrowRight size={18} />
        </Link>
      </div>
    );
  if (!hydrated || !attemptReady)
    return (
      <div className="empty-state" role="status">
        <LoaderCircle className="spin" />
        <p>Загружаем корзину…</p>
      </div>
    );
  if (!items.length)
    return (
      <div className="empty-state">
        <h1>В корзине пока пусто</h1>
        <p>Выберите технику, которая вам подходит.</p>
        <Link className="button button-primary" href="/catalog">
          Перейти в каталог <ArrowRight size={18} />
        </Link>
      </div>
    );
  return (
    <form
      ref={formRef}
      noValidate
      className="checkout-layout"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy.current || locked || status === "uncertain") return;
        setError("");
        const parsed = orderSchema.safeParse({
          ...values,
          delivery,
          consent,
          items: items.map(({ productId, variantId, quantity }) => ({
            productId,
            variantId,
            quantity,
          })),
        });
        if (!parsed.success) {
          const next: Record<string, string> = {};
          parsed.error.issues.forEach((i) => {
            const key = String(i.path[0]);
            if (!next[key]) next[key] = i.message;
          });
          setErrors(next);
          if (next.items) setError(next.items);
          const first = parsed.error.issues[0]?.path[0];
          (
            formRef.current?.elements.namedItem(
              String(first),
            ) as HTMLElement | null
          )?.focus();
          return;
        }
        setErrors({});
        const attemptKey = crypto.randomUUID();
        try {
          const previous = readOrderAttempt(localStorage);
          if (previous) {
            requestId.current = previous.key;
            setStatus("uncertain");
            setError(
              "Предыдущая заявка могла дойти. Уточните её статус у магазина.",
            );
            return;
          }
          if (
            !writeOrderAttempt(localStorage, {
              key: attemptKey,
              status: "pending",
              createdAt: Date.now(),
            })
          )
            throw new Error("Storage unavailable");
        } catch {
          setError(
            "Не удалось сохранить статус отправки. Разрешите хранилище браузера для сайта или напишите в магазин.",
          );
          return;
        }
        requestId.current = attemptKey;
        setStatus("pending");
        busy.current = true;
        setLocked(true);
        try {
          const response = await fetch("/api/order", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": attemptKey,
            },
            body: JSON.stringify(parsed.data),
          });
          const data = await response.json();
          if (!response.ok) {
            if (data.uncertain) {
              setStatus("uncertain");
              writeOrderAttempt(localStorage, {
                key: attemptKey,
                status: "uncertain",
                createdAt: Date.now(),
              });
            } else {
              clearOrderAttempt(localStorage, attemptKey);
              setStatus("idle");
              requestId.current = null;
            }
            setError(
              data.error || "Не удалось отправить заявку. Попробуйте позже.",
            );
            return;
          }
          setOrderId(data.orderId);
          setStatus("success");
          clearOrderAttempt(localStorage, attemptKey);
          setLocked(false);
          clear();
        } catch {
          setError(
            "Не удалось получить подтверждение отправки. Заявка могла дойти. Свяжитесь с магазином перед повторной отправкой.",
          );
          setStatus("uncertain");
          try {
            writeOrderAttempt(localStorage, {
              key: attemptKey,
              status: "uncertain",
              createdAt: Date.now(),
            });
          } catch {
            /* Original pending attempt remains. */
          }
        } finally {
          busy.current = false;
          setLocked(false);
        }
      }}
    >
      <div className="checkout-form">
        <Link href="/catalog" className="back-link">
          <ArrowLeft size={16} /> Вернуться к покупкам
        </Link>
        <h1>Оформление заказа</h1>
        <p className="muted">
          Пара деталей — и мы свяжемся с вами для подтверждения.
        </p>
        <section className="form-section">
          <h2>
            <span>1</span> Контактные данные
          </h2>
          <div className="form-grid">
            {(
              [
                ["name", "Ваше имя", "text", "Иван"],
                ["phone", "Телефон", "tel", "+7 (999) 123-45-67"],
                ["email", "Email", "email", "you@example.ru"],
              ] as const
            ).map(([name, label, type, placeholder]) => (
              <Input
                key={name}
                name={name}
                label={label}
                type={type}
                placeholder={placeholder}
                autoComplete={
                  name === "name" ? "name" : name === "phone" ? "tel" : "email"
                }
                required
                value={values[name]}
                error={errors[name]}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [name]: e.target.value }));
                  requestId.current = null;
                }}
              />
            ))}
          </div>
        </section>
        <section className="form-section">
          <h2>
            <span>2</span> Способ получения
          </h2>
          <div className="delivery-options">
            <label className={delivery === "delivery" ? "active" : ""}>
              <input
                type="radio"
                name="delivery"
                value="delivery"
                checked={delivery === "delivery"}
                onChange={() => setDelivery("delivery")}
              />
              <Truck size={22} />
              <strong>Доставка</strong>
              <small>Стоимость уточнит менеджер</small>
            </label>
            <label className={delivery === "pickup" ? "active" : ""}>
              <input
                type="radio"
                name="delivery"
                value="pickup"
                checked={delivery === "pickup"}
                onChange={() => setDelivery("pickup")}
              />
              <MapPin size={22} />
              <strong>Самовывоз</strong>
              <small>Место и время согласуем при подтверждении</small>
            </label>
          </div>
          {delivery === "delivery" && (
            <Input
              name="address"
              label="Адрес доставки"
              autoComplete="street-address"
              placeholder="Город, улица, дом, квартира"
              value={values.address}
              error={errors.address}
              onChange={(e) =>
                setValues((v) => ({ ...v, address: e.target.value }))
              }
            />
          )}
          <div className="field">
            <label htmlFor="comment">
              Комментарий к заказу{" "}
              <span className="muted">· необязательно</span>
            </label>
            <textarea
              id="comment"
              name="comment"
              className="input"
              rows={3}
              maxLength={1000}
              value={values.comment}
              onChange={(e) =>
                setValues((v) => ({ ...v, comment: e.target.value }))
              }
              placeholder="Например, удобное время для звонка"
            />
            <span className="field-error">{errors.comment}</span>
          </div>
        </section>
      </div>
      <aside className="order-summary">
        <h2>
          Ваш заказ <span>{items.reduce((n, i) => n + i.quantity, 0)}</span>
        </h2>
        <div className="summary-items">
          {items.map((item) => (
            <div className="summary-item" key={cartKey(item)}>
              <div className="summary-image">
                <Image src={item.image} alt="" width={64} height={64} />
              </div>
              <div>
                <strong>{item.name}</strong>
                <p>{item.variant}</p>
                <span>
                  {item.quantity} шт. × {formatPrice(item.price)}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="summary-line">
          <span>Товары</span>
          <strong>{formatPrice(total)}</strong>
        </div>
        <div className="summary-line muted">
          <span>Получение</span>
          <span>
            {delivery === "pickup" ? "Самовывоз" : "Уточнит менеджер"}
          </span>
        </div>
        <div className="summary-total">
          <span>Итого за товары</span>
          <strong>{formatPrice(total)}</strong>
        </div>
        <p className="summary-help">
          Наличие, итоговую стоимость и доставку подтвердит менеджер.
          Онлайн-оплата не требуется.
        </p>
        <label className="consent">
          <input
            type="checkbox"
            name="consent"
            checked={consent}
            aria-invalid={!!errors.consent}
            aria-describedby="consent-error"
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            Согласен на обработку контактных данных для оформления заказа и
            передачу заявки менеджеру через Telegram.
          </span>
        </label>
        <span className="field-error" id="consent-error">
          {errors.consent}
        </span>
        {error && <Notice error>{error}</Notice>}
        {status === "uncertain" && (
          <div className="attempt-recovery">
            <p>
              Сначала уточните статус по почте{" "}
              <a href={`mailto:${STORE_EMAIL}`}>{STORE_EMAIL}</a>. Повторная
              отправка разрешается, только если менеджер подтвердил отсутствие
              заявки.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={locked}
              onClick={() => {
                try {
                  clearOrderAttempt(localStorage);
                  requestId.current = null;
                  setStatus("idle");
                  setError("");
                } catch {
                  setError(
                    "Не удалось обновить статус. Проверьте доступ к хранилищу браузера.",
                  );
                }
              }}
            >
              Менеджер подтвердил: заявки нет
            </Button>
          </div>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={locked || status === "pending" || status === "uncertain"}
        >
          {status === "pending" ? (
            <>
              <LoaderCircle className="spin" size={18} /> Отправляем…
            </>
          ) : status === "uncertain" ? (
            "Нужно подтверждение менеджера"
          ) : (
            <>
              Отправить заявку <ArrowRight size={18} />
            </>
          )}
        </Button>
        <p className="secure-caption">
          <ShieldCheck size={15} /> Контакты используются для обработки заявки
        </p>
      </aside>
    </form>
  );
}
