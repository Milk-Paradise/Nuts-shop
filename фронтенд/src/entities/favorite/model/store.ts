import { createStore } from "zustand/vanilla";
export interface FavoriteState {
  favorites: string[];
  comparison: string[];
  hydrated: boolean;
  toggleFavorite: (id: string) => void;
  toggleCompare: (id: string) => void;
  hydrate: (favorites: string[], comparison: string[]) => void;
}
const toggle = (items: string[], id: string) =>
  items.includes(id) ? items.filter((i) => i !== id) : [...items, id];
export function createFavoriteStore() {
  return createStore<FavoriteState>()((set) => ({
    favorites: [],
    comparison: [],
    hydrated: false,
    toggleFavorite: (id) =>
      set((s) => ({ favorites: toggle(s.favorites, id) })),
    toggleCompare: (id) =>
      set((s) => ({ comparison: toggle(s.comparison, id) })),
    hydrate: (favorites, comparison) =>
      set({ favorites, comparison, hydrated: true }),
  }));
}
