export const SITE_NAME = "Nuts Store";
export const STORE_EMAIL = "info@11centov.ru";
export const STORE_BRAND = "Apple";
export type Theme = "dawn" | "day" | "dusk" | "night";
export type ThemeMode = "auto" | "light" | "dark";
export function themeByHour(hour: number): Theme {
  return hour >= 6 && hour < 9
    ? "dawn"
    : hour >= 9 && hour < 18
      ? "day"
      : hour >= 18 && hour < 21
        ? "dusk"
        : "night";
}
export const THEME_SCRIPT = `(function(){try{var m=localStorage.getItem('11c-theme')||'auto';var h=new Date().getHours();var t=m==='dark'?'night':m==='light'?'day':h>=6&&h<9?'dawn':h>=9&&h<18?'day':h>=18&&h<21?'dusk':'night';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='night'?'dark':'light'}catch(e){}})()`;
