import { CatalogPage, type SearchParams } from "@/pages/catalog";
export const metadata = { title: "Каталог" };
export default async function Catalog({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <CatalogPage searchParams={await searchParams} />;
}
