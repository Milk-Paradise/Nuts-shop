"use client";
import { useEffect } from "react";
import { themeByHour, type ThemeMode } from "@/shared/config";
export function CircadianTheme() {
  useEffect(() => {
    const update = () => {
      let mode: ThemeMode = "auto";
      try {
        const stored = localStorage.getItem("11c-theme");
        if (stored === "light" || stored === "dark") mode = stored;
      } catch {
        /* Auto mode */
      }
      const theme =
        mode === "dark"
          ? "night"
          : mode === "light"
            ? "day"
            : themeByHour(new Date().getHours());
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme =
        theme === "night" ? "dark" : "light";
    };
    update();
    const timer = setInterval(update, 60000);
    window.addEventListener("11c-theme-change", update);
    window.addEventListener("storage", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("11c-theme-change", update);
      window.removeEventListener("storage", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return null;
}
