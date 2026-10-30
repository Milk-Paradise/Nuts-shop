"use client";
import { useEffect } from "react";
import { Button } from "@/shared/ui";
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Store rendering error", error.digest || error.name);
  }, [error]);
  return (
    <div className="container empty-state">
      <h1>Не удалось загрузить страницу</h1>
      <p>Каталог временно недоступен. Попробуйте ещё раз чуть позже.</p>
      <Button onClick={reset}>Попробовать снова</Button>
    </div>
  );
}
