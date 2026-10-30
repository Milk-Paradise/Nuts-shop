import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { orderSchema, buildOrder } from "@/entities/order";
import { getProducts, isMockCatalog } from "@/entities/product/server";
import { escapeHtml, formatPrice } from "@/shared/lib";
import { SITE_NAME, STORE_EMAIL } from "@/shared/config";
import { sendTelegramMessage, TelegramError } from "@/shared/api";

export const runtime = "nodejs";
type Result = { body: Record<string, unknown>; status: number };
// Bounded process-local replay protection. TODO production multi-instance deployment:
// replace with a durable idempotency repository (Redis/SQL) before scaling workers.
const requests = new Map<
  string,
  { hash: string; created: number; result: Promise<Result> }
>();
const limits = new Map<string, { count: number; resetAt: number }>();
const TTL = 30 * 60 * 1000;
function prune() {
  const now = Date.now();
  for (const [key, value] of requests)
    if (now - value.created > TTL) requests.delete(key);
  for (const [key, value] of limits)
    if (value.resetAt < now) limits.delete(key);
}
function result(body: Record<string, unknown>, status = 200): Result {
  return { body, status };
}

export async function POST(request: NextRequest) {
  const respond = (value: Result) =>
    NextResponse.json(value.body, {
      status: value.status,
      headers: { "Cache-Control": "no-store" },
    });
  const origin = request.headers.get("origin");
  const publicHost = request.headers.get("host") || request.nextUrl.host;
  const expectedOrigin =
    process.env.APP_ORIGIN || `${request.nextUrl.protocol}//${publicHost}`;
  if (origin && origin !== expectedOrigin)
    return respond(result({ error: "Недопустимый источник запроса." }, 403));
  if (!request.headers.get("content-type")?.includes("application/json"))
    return respond(result({ error: "Ожидается JSON." }, 415));
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID)
    return respond(
      result(
        {
          error: `Приём заявок ещё настраивается. Напишите нам: ${STORE_EMAIL}. Ваши товары остались в корзине.`,
        },
        503,
      ),
    );
  const key = request.headers.get("idempotency-key");
  if (
    !key ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(key)
  )
    return respond(
      result({ error: "Обновите страницу и попробуйте снова." }, 400),
    );
  let raw = "";
  try {
    const reader = request.body?.getReader();
    if (!reader) return respond(result({ error: "Пустой запрос." }, 400));
    let size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 24000) {
        await reader.cancel();
        return respond(result({ error: "Слишком большой запрос." }, 413));
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return respond(result({ error: "Не удалось прочитать заявку." }, 400));
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return respond(result({ error: "Некорректный JSON." }, 400));
  }
  const parsed = orderSchema.safeParse(payload);
  if (!parsed.success)
    return respond(
      result(
        { error: parsed.error.issues[0]?.message || "Проверьте поля заявки." },
        400,
      ),
    );
  prune();
  const hash = createHash("sha256")
    .update(JSON.stringify(parsed.data))
    .digest("hex");
  const existing = requests.get(key);
  if (existing) {
    if (existing.hash !== hash)
      return respond(
        result({ error: "Состав заявки изменился. Обновите страницу." }, 409),
      );
    return respond(await existing.result);
  }
  if (requests.size >= 2000 || limits.size >= 2000)
    return respond(result({ error: "Сервис занят. Попробуйте позже." }, 503));
  // Only trust this header when set/overwritten by your deployment reverse proxy.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const rate = limits.get(ip) || { count: 0, resetAt: Date.now() + 600000 };
  if (rate.count >= 5)
    return respond(
      result(
        { error: "Слишком много заявок. Попробуйте через 10 минут." },
        429,
      ),
    );
  rate.count++;
  limits.set(ip, rate);
  const pending = (async (): Promise<Result> => {
    let products;
    try {
      products = await getProducts();
    } catch {
      return result(
        { error: "Не удалось проверить цены и наличие. Попробуйте позже." },
        503,
      );
    }
    let order;
    try {
      order = buildOrder(parsed.data, products);
    } catch (error) {
      return result(
        {
          error:
            error instanceof Error
              ? error.message
              : "Проверьте товары в корзине.",
        },
        409,
      );
    }
    const id = `11C-${randomUUID().slice(0, 8).toUpperCase()}`;
    const esc = escapeHtml;
    const lines = order.items.map(
      (item, i) =>
        `${i + 1}. <b>${esc(item.name)}</b>\n${esc(item.variant)} · ${item.quantity} шт. × ${formatPrice(item.price)} = ${formatPrice(item.subtotal)}`,
    );
    const text = [
      `<b>${isMockCatalog() ? "ДЕМО · " : ""}${SITE_NAME} · Новая заявка ${id}</b>`,
      "",
      ...lines,
      "",
      `<b>Товары: ${formatPrice(order.total)}</b>`,
      "Стоимость доставки и наличие требуют подтверждения.",
      "",
      `<b>Имя:</b> ${esc(order.name)}`,
      `<b>Телефон:</b> ${esc(order.phone)}`,
      `<b>Email:</b> ${esc(order.email)}`,
      `<b>Получение:</b> ${order.delivery === "pickup" ? "Самовывоз" : "Доставка"}`,
      `<b>Адрес:</b> ${order.delivery === "pickup" ? "Самовывоз — место согласовать" : esc(order.address)}`,
      order.comment ? `<b>Комментарий:</b> ${esc(order.comment)}` : "",
      "",
      `<b>Время:</b> ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Moscow" }).format(new Date())} (МСК)`,
    ]
      .filter((line) => line !== undefined)
      .join("\n");
    if (text.length > 4000)
      return result(
        {
          error:
            "Заявка слишком длинная. Сократите комментарий или количество разных позиций.",
        },
        400,
      );
    try {
      await sendTelegramMessage(text);
      return result({ ok: true, orderId: id, total: order.total });
    } catch (error) {
      const uncertain = error instanceof TelegramError && error.uncertain;
      return result(
        {
          error: uncertain
            ? "Не удалось подтвердить доставку заявки. Она могла дойти. Свяжитесь с магазином перед повторной отправкой."
            : "Не удалось отправить заявку менеджеру. Позвоните в магазин или попробуйте позже.",
          uncertain,
        },
        502,
      );
    }
  })();
  requests.set(key, { hash, created: Date.now(), result: pending });
  return respond(await pending);
}
