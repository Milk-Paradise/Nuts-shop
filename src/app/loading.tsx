import { Skeleton } from "@/shared/ui";
export default function Loading() {
  return (
    <div className="container loading-page" role="status">
      <span className="sr-only">Загрузка страницы</span>
      <Skeleton className="loading-title" />
      <div className="product-grid">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="loading-card" />
        ))}
      </div>
    </div>
  );
}
