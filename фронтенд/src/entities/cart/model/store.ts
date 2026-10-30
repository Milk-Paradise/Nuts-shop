import { createStore } from "zustand/vanilla";
export interface CartItem {
  productId: string;
  variantId: string;
  name: string;
  variant: string;
  price: number;
  image: string;
  slug: string;
  brand?: string;
  quantity: number;
}
export type CartInput = Omit<CartItem, "quantity">;
export interface CartState {
  items: CartItem[];
  open: boolean;
  hydrated: boolean;
  locked: boolean;
  setLocked: (locked: boolean) => void;
  add: (item: CartInput) => void;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  setOpen: (open: boolean) => void;
  clear: () => void;
  hydrate: (items: CartItem[]) => void;
}
export const cartKey = (item: Pick<CartItem, "productId" | "variantId">) =>
  `${item.productId}:${item.variantId}`;
export function createCartStore() {
  return createStore<CartState>()((set) => ({
    items: [],
    open: false,
    hydrated: false,
    locked: false,
    setLocked: (locked) => set({ locked }),
    add: (item) =>
      set((state) => {
        if (state.locked) return state;
        const key = cartKey(item);
        const exists = state.items.some((i) => cartKey(i) === key);
        return {
          items: exists
            ? state.items.map((i) =>
                cartKey(i) === key
                  ? { ...i, quantity: Math.min(i.quantity + 1, 99) }
                  : i,
              )
            : [...state.items, { ...item, quantity: 1 }],
        };
      }),
    remove: (key) =>
      set((state) =>
        state.locked
          ? state
          : {
              items: state.items.filter((i) => cartKey(i) !== key),
            },
      ),
    setQuantity: (key, quantity) =>
      set((state) =>
        state.locked
          ? state
          : {
              items: state.items.map((i) =>
                cartKey(i) === key
                  ? {
                      ...i,
                      quantity: Math.max(
                        1,
                        Math.min(
                          99,
                          Math.floor(Number.isFinite(quantity) ? quantity : 1),
                        ),
                      ),
                    }
                  : i,
              ),
            },
      ),
    setOpen: (open) => set({ open }),
    clear: () => set((state) => (state.locked ? state : { items: [] })),
    hydrate: (items) => set({ items, hydrated: true }),
  }));
}
export const selectCartTotal = (state: CartState) =>
  state.items.reduce((total, item) => total + item.price * item.quantity, 0);
export const selectCartCount = (state: CartState) =>
  state.items.reduce((total, item) => total + item.quantity, 0);
