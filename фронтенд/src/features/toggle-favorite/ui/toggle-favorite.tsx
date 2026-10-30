"use client";
import { Heart } from "lucide-react";
import { useFavorite } from "@/entities/favorite";
export function ToggleFavorite({ id }: { id: string }) {
  const selected = useFavorite((s) => s.favorites.includes(id));
  const toggle = useFavorite((s) => s.toggleFavorite);
  const hydrated = useFavorite((s) => s.hydrated);
  return (
    <button
      className={`icon-button favorite-button ${selected ? "selected" : ""}`}
      aria-label={selected ? "Убрать из избранного" : "В избранное"}
      aria-pressed={selected}
      disabled={!hydrated}
      onClick={() => toggle(id)}
    >
      <Heart size={19} fill={selected ? "currentColor" : "none"} />
    </button>
  );
}
