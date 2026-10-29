"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { createFavoriteStore, type FavoriteState } from "./store";
const Context = createContext<ReturnType<typeof createFavoriteStore> | null>(
  null,
);
export function FavoriteProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createFavoriteStore);
  useEffect(() => {
    let favorites: string[] = [],
      comparison: string[] = [];
    try {
      const data = JSON.parse(localStorage.getItem("11c-favorites") || "{}");
      if (Array.isArray(data.favorites))
        favorites = data.favorites
          .filter((id: unknown): id is string => typeof id === "string")
          .slice(0, 500);
      if (Array.isArray(data.comparison))
        comparison = data.comparison
          .filter((id: unknown): id is string => typeof id === "string")
          .slice(0, 100);
    } catch {
      /* Session-only. */
    }
    store.getState().hydrate(favorites, comparison);
    return store.subscribe((s) => {
      try {
        localStorage.setItem(
          "11c-favorites",
          JSON.stringify({ favorites: s.favorites, comparison: s.comparison }),
        );
      } catch {
        /* Session remains usable. */
      }
    });
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useFavorite<T>(selector: (s: FavoriteState) => T) {
  const store = useContext(Context);
  if (!store) throw new Error("FavoriteProvider is missing");
  return useStore(store, selector);
}
