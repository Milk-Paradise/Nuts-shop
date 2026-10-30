import { ProductPage } from "@/pages/product";
import { getProduct } from "@/entities/product/server";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProduct(slug);
  return { title: product?.name || "Товар не найден" };
}
export default async function Product({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <ProductPage slug={(await params).slug} />;
}
