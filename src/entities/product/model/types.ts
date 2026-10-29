export interface ProductVariant {
  id: string;
  label: string;
  color: string;
  colorHex: string;
  storage: string;
  price: number;
  stock: number;
  image?: string;
}
export interface Product {
  id: string;
  slug: string;
  name: string;
  brand: string;
  categoryId: string;
  description: string;
  image: string;
  images: string[];
  price: number;
  rating: number;
  reviewCount: number;
  badge?: string;
  specs: Record<string, string>;
  variants: ProductVariant[];
}
export interface CatalogFilters {
  category?: string;
  brand?: string;
  q?: string;
  sort?: string;
  min?: number;
  max?: number;
  inStock?: boolean;
}
