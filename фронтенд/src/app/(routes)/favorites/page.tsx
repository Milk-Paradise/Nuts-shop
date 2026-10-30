import { SavedPage } from "@/pages/saved";
export const metadata = { title: "Избранное" };
export default function Favorites() {
  return <SavedPage mode="favorites" />;
}
