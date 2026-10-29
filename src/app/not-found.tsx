import Link from "next/link";
export default function NotFound() {
  return (
    <div className="container empty-state">
      <span className="eyebrow">404</span>
      <h1>Кажется, здесь ничего нет</h1>
      <p>Зато в каталоге есть много интересного.</p>
      <Link href="/catalog" className="button button-primary">
        Перейти в каталог
      </Link>
    </div>
  );
}
