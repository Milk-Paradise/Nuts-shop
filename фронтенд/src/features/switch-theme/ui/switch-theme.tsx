"use client";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import type { ThemeMode } from "@/shared/config";
export function SwitchTheme() {
  const [mode, setMode] = useState<ThemeMode>("auto");
  useEffect(() => {
    try {
      const value = localStorage.getItem("11c-theme");
      if (value === "light" || value === "dark") setMode(value);
    } catch {
      /* Auto */
    }
  }, []);
  const labels = {
    auto: "Автоматическая тема",
    light: "Светлая тема",
    dark: "Тёмная тема",
  };
  const next = mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";
  return (
    <button
      className="icon-button theme-switch"
      title={`${labels[mode]}. Включить: ${labels[next].toLowerCase()}`}
      aria-label={`${labels[mode]}. Включить: ${labels[next].toLowerCase()}`}
      onClick={() => {
        setMode(next);
        try {
          localStorage.setItem("11c-theme", next);
        } catch {
          /* Session override */ document.documentElement.dataset.theme =
            next === "dark" ? "night" : "day";
          return;
        }
        window.dispatchEvent(new Event("11c-theme-change"));
      }}
    >
      {mode === "dark" ? (
        <Moon size={19} />
      ) : mode === "light" ? (
        <Sun size={19} />
      ) : (
        <Monitor size={19} />
      )}
    </button>
  );
}
