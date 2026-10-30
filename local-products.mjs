import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
const remote = Boolean(process.env.NUTS_BACKEND_URL);
const settings = remote ? {} : JSON.parse(await readFile(path.join(root, ".local/catalog.json")));
const credentials = JSON.parse(await readFile(process.env.NUTS_ADMIN_CREDENTIALS || path.join(root, ".local/admin-credentials.json")));
const base = process.env.NUTS_BACKEND_URL || "http://127.0.0.1:9000";
let token;
async function request(url, data, method = "POST") {
  const response = await fetch(base + url, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(data && !(data instanceof FormData) ? { "Content-Type": "application/json" } : {}),
  }, body: data instanceof FormData ? data : data ? JSON.stringify(data) : undefined });
  const body = await response.json();
  if (!response.ok) throw new Error(`${method} ${url}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
token = (await request("/auth/user/emailpass", credentials)).token;
if (remote) {
  settings.salesChannelId = (await request("/admin/sales-channels", undefined, "GET")).sales_channels.find((item) => item.name === "Nuts Store")?.id;
  settings.stockLocationId = (await request("/admin/stock-locations", undefined, "GET")).stock_locations.find((item) => item.name === "Main Warehouse")?.id;
  settings.shippingProfileId = (await request("/admin/shipping-profiles", undefined, "GET")).shipping_profiles.find((item) => item.name === "Default Shipping Profile")?.id;
  if (!settings.salesChannelId || !settings.stockLocationId || !settings.shippingProfileId) throw new Error("Nuts Store commerce baseline is missing");
}
const fixtures = [
  { title: "Apple iPhone 16 128 GB", handle: "local-iphone-16-128", category: "smartphones", categoryName: "Смартфоны", image: "iphone-hq.png", price: 69990, stock: 5, storage: "128 GB", color: "Чёрный", sku: "NUTS-LOCAL-IP16-128" },
  { title: "Apple AirPods Pro 2", handle: "local-airpods-pro-2", category: "headphones", categoryName: "Наушники", image: "airpods-pro.png", price: 19990, stock: 8, storage: "USB-C", color: "Белый", sku: "NUTS-LOCAL-AIRPODS-PRO2" },
];
for (const item of fixtures) {
  const existing = await request(`/admin/products?handle=${item.handle}`, undefined, "GET");
  if (existing.products.length) { console.log(`Already exists: ${item.title}`); continue; }
  let category = (await request(`/admin/product-categories?handle=${item.category}`, undefined, "GET")).product_categories[0];
  if (!category) category = (await request("/admin/product-categories", { name: item.categoryName, handle: item.category, is_active: true, is_internal: false })).product_category;
  const form = new FormData();
  form.append("files", new Blob([await readFile(path.join(root, "фронтенд/public/images", item.image))], { type: "image/png" }), item.image);
  const imageUrl = (await request("/admin/uploads", form)).files[0].url;
  const { product } = await request("/admin/products", {
    title: item.title, handle: item.handle, status: "published",
    description: "Тестовый товар для проверки локальной связи Nuts Store с Medusa. Цена и остаток демонстрационные.",
    thumbnail: imageUrl, images: [{ url: imageUrl }],
    metadata: { brand: "Apple", categoryId: item.category, characteristics: { Бренд: "Apple", Конфигурация: item.storage } },
    categories: [{ id: category.id }], sales_channels: [{ id: settings.salesChannelId }],
    shipping_profile_id: settings.shippingProfileId,
    options: [{ title: "Память", values: [item.storage] }, { title: "Цвет", values: [item.color] }],
    variants: [{ title: `${item.storage} / ${item.color}`, sku: item.sku, manage_inventory: true, allow_backorder: false,
      options: { Память: item.storage, Цвет: item.color }, prices: [{ currency_code: "rub", amount: item.price }] }],
  });
  const detail = await request(`/admin/products/${product.id}?fields=*variants.inventory_items`, undefined, "GET");
  const inventoryItemId = detail.product.variants[0].inventory_items[0].inventory_item_id;
  await request(`/admin/inventory-items/${inventoryItemId}/location-levels`, { location_id: settings.stockLocationId, stocked_quantity: item.stock });
  console.log(`Created: ${item.title}; ${item.price} RUB; stock ${item.stock}`);
}
if (!remote) await writeFile(path.join(root, "фронтенд/.env.local"), `USE_MOCK=false\nCATALOG_API_FORMAT=medusa\nCATALOG_API_URL=http://127.0.0.1:9000\nCATALOG_PRODUCTS_PATH=/store/products\nCATALOG_PUBLISHABLE_KEY=${settings.publishableKey}\nCATALOG_REGION_ID=${settings.regionId}\nCATALOG_IMAGE_HOST=localhost\nCATALOG_IMAGE_PROTOCOL=http\nCATALOG_IMAGE_PORT=9000\nAPP_ORIGIN=http://localhost:3000\n`);


