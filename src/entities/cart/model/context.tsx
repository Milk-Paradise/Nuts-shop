"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { z } from "zod";
import { createCartStore, type CartState } from "./store";
import { STORE_BRAND } from "@/shared/config";
const Context = createContext<ReturnType<typeof createCartStore> | null>(null);
const itemSchema = z.object({
  productId: z.string(),
  variantId: z.string(),
  name: z.string(),
  variant: z.string(),
  price: z.number().nonnegative(),
  image: z.string(),
  slug: z.string(),
  brand: z.string().optional(),
  quantity: z.number().int().min(1).max(99),
});
export function CartProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createCartStore);
  useEffect(() => {
    let items: CartState["items"] = [];
    try {
      const parsed = z
        .array(itemSchema)
        .max(100)
        .safeParse(JSON.parse(localStorage.getItem("11c-cart") || "[]"));
      if (parsed.success)
        items = parsed.data.filter((item) =>
          item.brand
            ? item.brand.trim().toLowerCase() === STORE_BRAND.toLowerCase()
            : item.name.startsWith(`${STORE_BRAND} `),
        );
    } catch {
      /* Storage unavailable: session-only state. */
    }
    store.getState().hydrate(items);
    return store.subscribe((state) => {
      try {
        localStorage.setItem("11c-cart", JSON.stringify(state.items));
      } catch {
        /* Session remains usable. */
      }
    });
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useCart<T>(selector: (state: CartState) => T): T {
  const store = useContext(Context);
  if (!store) throw new Error("CartProvider is missing");
  return useStore(store, selector);
}
