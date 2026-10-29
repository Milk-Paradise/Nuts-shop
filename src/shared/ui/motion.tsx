"use client";
import type { ReactNode } from "react";
import AnimatedContent from "./react-bits/AnimatedContent";
import FadeContent from "./react-bits/FadeContent";
import Aurora from "./react-bits/Aurora";
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <AnimatedContent
      className={className}
      distance={24}
      duration={0.65}
      delay={delay}
      threshold={0.06}
      once
    >
      {children}
    </AnimatedContent>
  );
}
export function Fade({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <FadeContent className={className} duration={0.8} once>
      {children}
    </FadeContent>
  );
}
const stops = ["#e8a3ae", "#f6dde1", "#c85c6e"];
export function HeroAurora() {
  return (
    <div className="hero-aurora" aria-hidden="true">
      <Aurora
        colorStops={stops}
        speed={0.25}
        amplitude={0.7}
        blend={0.7}
        mouseInteraction={false}
        lightMode
        opacity={0.35}
      />
    </div>
  );
}
