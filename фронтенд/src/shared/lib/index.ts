import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}
export function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}
export function plural(value: number) {
  const n = value % 100;
  return n > 10 && n < 20
    ? "товаров"
    : value % 10 === 1
      ? "товар"
      : value % 10 >= 2 && value % 10 <= 4
        ? "товара"
        : "товаров";
}
export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
export async function fetcher<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Ошибка запроса: ${response.status}`);
  return response.json() as Promise<T>;
}
