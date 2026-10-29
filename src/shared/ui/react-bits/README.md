# React Bits components

Upstream: https://github.com/DavidHDev/react-bits (downloaded 2026-10-29).
Aurora, FadeContent and AnimatedContent, TypeScript + Tailwind variants.
License retained in LICENSE.md. GSAP dependency for the reveal components.
Local adaptation: removed the initial `invisible` class from reveal wrappers so
server-rendered content remains available without JavaScript. Upstream already
handles prefers-reduced-motion in all three components.
