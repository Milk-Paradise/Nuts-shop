import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("reads paginated Medusa prices, options and stock with the publishable key", async () => {
  vi.stubEnv("USE_MOCK", "false");
  vi.stubEnv("CATALOG_API_FORMAT", "medusa");
  vi.stubEnv("CATALOG_API_URL", "http://localhost:9000");
  vi.stubEnv("CATALOG_PRODUCTS_PATH", "/store/products");
  vi.stubEnv("CATALOG_PUBLISHABLE_KEY", "pk_test");
  vi.stubEnv("CATALOG_REGION_ID", "reg_test_rub");
  const source = {
    id: "prod_1",
    handle: "iphone-local",
    title: "iPhone local",
    metadata: { brand: "Apple", categoryId: "smartphones" },
    variants: [
      {
        id: "variant_1",
        title: "128 GB",
        manage_inventory: true,
        allow_backorder: false,
        inventory_quantity: 3,
        calculated_price: { calculated_amount: 69000 },
        options: [{ value: "128 GB", option: { title: "Память" } }],
      },
    ],
  };
  const calls: { url: string; headers: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, options: RequestInit) => {
      calls.push({ url: url.href, headers: options.headers });
      return Response.json({
        products: [{ ...source, id: `prod_${calls.length}` }],
        count: 2,
      });
    }),
  );
  const { getProducts } = await import("@/entities/product/server");
  const products = await getProducts();
  expect(products).toHaveLength(2);
  expect(products[0]).toMatchObject({
    price: 69000,
    slug: "iphone-local",
    categoryId: "smartphones",
    variants: [{ stock: 3, storage: "128 GB" }],
  });
  expect(calls[1].url).toContain("offset=1");
  expect(calls[0].headers).toMatchObject({
    "x-publishable-api-key": "pk_test",
  });
});
