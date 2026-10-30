"use client";
import type { ReactNode } from "react";
import { CartProvider } from "@/entities/cart";
import { FavoriteProvider } from "@/entities/favorite";
import { CircadianTheme } from "@/features/circadian-theme";
export function Providers({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <FavoriteProvider>
        <CircadianTheme />
        {children}
      </FavoriteProvider>
    </CartProvider>
  );
}
