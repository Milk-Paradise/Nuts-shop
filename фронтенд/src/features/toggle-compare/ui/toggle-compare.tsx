"use client";
import { ChartNoAxesColumnIncreasing } from "lucide-react";
import { useFavorite } from "@/entities/favorite";
export function ToggleCompare({ id }: { id: string }) {
  const selected = useFavorite((s) => s.comparison.includes(id));
  const toggle = useFavorite((s) => s.toggleCompare);
  const hydrated = useFavorite((s) => s.hydrated);
  return (
    <button
      className={`icon-button compare-button ${selected ? "selected" : ""}`}
      aria-label={selected ? "Убрать из сравнения" : "Добавить к сравнению"}
      aria-pressed={selected}
      disabled={!hydrated}
      onClick={() => toggle(id)}
    >
      <ChartNoAxesColumnIncreasing size={19} />
    </button>
  );
}
