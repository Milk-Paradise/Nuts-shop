import { InfoPage } from "@/pages/info";
export default async function Info({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <InfoPage slug={(await params).slug} />;
}
