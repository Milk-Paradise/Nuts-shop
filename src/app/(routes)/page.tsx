import { HomePage } from "@/pages/home";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  return <HomePage category={category} />;
}
