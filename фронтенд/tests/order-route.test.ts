import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("@/entities/product/server", () => ({
  isMockCatalog: () => true,
  getProducts: async () => [
    {
      id: "p",
      name: "Phone <Pro>",
      variants: [{ id: "v", label: "128 GB", price: 900, stock: 5 }],
    },
  ],
}));
const payload = {
  name: "Анна <test>",
  phone: "+7 999 111 22 33",
  email: "test@example.ru",
  delivery: "delivery",
  address: "Москва, Мира 1",
  comment: "<b>срочно</b>",
  consent: true,
  items: [{ productId: "p", variantId: "v", quantity: 2, price: 1 }],
};
function req(
  body: unknown = payload,
  key = crypto.randomUUID(),
  origin = "http://localhost:3000",
) {
  return new NextRequest("http://localhost:3000/api/order", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
      origin,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_CHAT_ID", "-100000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("POST /api/order", () => {
  it("accepts same-origin requests when the internal Next URL uses localhost", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const { POST } = await import("@/app/api/order/route");
    const request = new NextRequest("http://localhost:3000/api/order", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify(payload),
    });
    expect((await POST(request)).status).toBe(503);
  });
  it("returns 503 without bot configuration and never sends", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/order/route");
    expect((await POST(req())).status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("rejects foreign origins before any send", async () => {
    const { POST } = await import("@/app/api/order/route");
    expect(
      (await POST(req(payload, crypto.randomUUID(), "https://evil.example")))
        .status,
    ).toBe(403);
  });
  it("rejects invalid quantities and unknown variants", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/order/route");
    expect(
      (
        await POST(
          req({
            ...payload,
            items: [{ productId: "p", variantId: "v", quantity: -1 }],
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          req({
            ...payload,
            items: [{ productId: "p", variantId: "missing", quantity: 1 }],
          }),
        )
      ).status,
    ).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("reprices, escapes customer HTML and deduplicates concurrent requests", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/order/route");
    const key = crypto.randomUUID();
    const responses = await Promise.all([
      POST(req(payload, key)),
      POST(req(payload, key)),
    ]);
    const first = await responses[0].json();
    expect(first.total).toBe(1800);
    expect(await responses[1].json()).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const options = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(options[1].body as string);
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).toContain("&lt;b&gt;срочно&lt;/b&gt;");
    expect(body.text).toContain("Анна &lt;test&gt;");
    expect(body.text).toContain("Phone &lt;Pro&gt;");
  });
  it("does not resend after an ambiguous timeout with the same key", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("timeout");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/order/route");
    const key = crypto.randomUUID();
    const first = await POST(req(payload, key));
    expect(first.status).toBe(502);
    expect((await first.json()).uncertain).toBe(true);
    await POST(req(payload, key));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it("rejects reusing a key for a different order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true })),
    );
    const { POST } = await import("@/app/api/order/route");
    const key = crypto.randomUUID();
    await POST(req(payload, key));
    expect(
      (await POST(req({ ...payload, name: "Другое имя" }, key))).status,
    ).toBe(409);
  });
});
