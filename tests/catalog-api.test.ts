import { afterEach, expect, it, vi } from "vitest";
import { mockProducts } from "@/entities/product/api/mock";
it("excludes other brands from a real catalog response", async () => {
  vi.stubEnv("USE_MOCK", "false");
  vi.stubEnv("CATALOG_API_URL", "https://catalog.example");
  const apple = mockProducts[0];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json([apple, { ...apple, id: "other-brand", brand: "Samsung" }]),
    ),
  );
  const { getProducts } = await import("@/entities/product/server");
  expect((await getProducts()).map((product) => product.id)).toEqual([
    apple.id,
  ]);
});
vi.mock("server-only", () => ({}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("preserves a deployed API base path and adds server-only authorization", async () => {
  vi.stubEnv("USE_MOCK", "false");
  vi.stubEnv("CATALOG_API_URL", "https://catalog.example/api/v1");
  vi.stubEnv("CATALOG_PRODUCTS_PATH", "/products");
  vi.stubEnv("CATALOG_API_TOKEN", "test-secret");
  const fetchSpy = vi.fn(async () => Response.json([]));
  vi.stubGlobal("fetch", fetchSpy);
  const { getProducts } = await import("@/entities/product/server");
  await getProducts();
  const args = fetchSpy.mock.calls[0] as unknown as [URL, RequestInit];
  expect(args[0].href).toBe("https://catalog.example/api/v1/products");
  expect(args[1].headers).toMatchObject({
    Authorization: "Bearer test-secret",
  });
});
it("does not silently substitute mock products for a failed real API", async () => {
  vi.stubEnv("USE_MOCK", "false");
  vi.stubEnv("CATALOG_API_URL", "https://catalog.example");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 503 })),
  );
  const { getProducts } = await import("@/entities/product/server");
  await expect(getProducts()).rejects.toThrow("503");
});
it("rejects an undocumented backend response shape", async () => {
  vi.stubEnv("USE_MOCK", "false");
  vi.stubEnv("CATALOG_API_URL", "https://catalog.example");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ items: [] })),
  );
  const { getProducts } = await import("@/entities/product/server");
  await expect(getProducts()).rejects.toThrow();
});
