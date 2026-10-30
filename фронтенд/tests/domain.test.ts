import { describe, expect, it } from "vitest";
import { createCartStore } from "@/entities/cart/model/store";
import { createFavoriteStore } from "@/entities/favorite/model/store";
import { orderSchema, buildOrder } from "@/entities/order";
import { escapeHtml } from "@/shared/lib";

describe("cart isolation and quantities", () => {
  const item = {
    productId: "phone",
    variantId: "128",
    name: "Phone",
    variant: "128 GB",
    price: 100,
    image: "/phone.png",
    slug: "phone",
  };
  it("never leaks a cart to a different request", () => {
    const a = createCartStore();
    const b = createCartStore();
    a.getState().add(item);
    expect(a.getState().items[0].quantity).toBe(1);
    expect(b.getState().items).toEqual([]);
  });
  it("prevents cart edits while a submitted order is awaiting confirmation", () => {
    const store = createCartStore();
    store.getState().add(item);
    store.getState().setLocked(true);
    store.getState().add({ ...item, variantId: "new" });
    store.getState().setQuantity("phone:128", 5);
    store.getState().remove("phone:128");
    expect(store.getState().items).toHaveLength(1);
    expect(store.getState().items[0].quantity).toBe(1);
    store.getState().setLocked(false);
    store.getState().clear();
    expect(store.getState().items).toEqual([]);
  });
  it("merges the same variant but keeps different variants separate", () => {
    const store = createCartStore();
    store.getState().add(item);
    store.getState().add(item);
    store.getState().add({ ...item, variantId: "256" });
    expect(store.getState().items.map((i) => i.quantity)).toEqual([2, 1]);
    store.getState().setQuantity("phone:128", 0);
    expect(store.getState().items[0].quantity).toBe(1);
    store.getState().setQuantity("phone:128", 500);
    expect(store.getState().items[0].quantity).toBe(99);
  });
  it("favorite and compare factories are isolated", () => {
    const a = createFavoriteStore();
    const b = createFavoriteStore();
    a.getState().toggleFavorite("phone");
    a.getState().toggleCompare("phone");
    expect(b.getState().favorites).toEqual([]);
    expect(a.getState().comparison).toEqual(["phone"]);
  });
});

describe("orders", () => {
  const input = {
    name: "Анна",
    phone: "+7 999 111 22 33",
    email: "a@example.ru",
    address: "Москва, Мира 1",
    comment: "",
    delivery: "delivery",
    consent: true,
    items: [{ productId: "p", variantId: "v", quantity: 2 }],
  };
  it("rejects empty cart, false consent and unreasonable quantities", () => {
    expect(orderSchema.safeParse({ ...input, items: [] }).success).toBe(false);
    expect(orderSchema.safeParse({ ...input, consent: false }).success).toBe(
      false,
    );
    expect(
      orderSchema.safeParse({
        ...input,
        items: [{ productId: "p", variantId: "v", quantity: 100 }],
      }).success,
    ).toBe(false);
  });
  it("ignores client prices and reprices against catalog", () => {
    const products = [
      {
        id: "p",
        slug: "phone",
        name: "Phone",
        brand: "Apple",
        categoryId: "smartphones",
        description: "",
        image: "/x",
        images: ["/x"],
        price: 90,
        rating: 4.9,
        reviewCount: 0,
        badge: "Хит",
        specs: {},
        variants: [
          {
            id: "v",
            label: "128 GB",
            color: "Чёрный",
            colorHex: "#111",
            storage: "128 GB",
            price: 90,
            stock: 3,
          },
        ],
      },
    ];
    const result = buildOrder(
      orderSchema.parse({ ...input, price: 1 }),
      products,
    );
    expect(result.total).toBe(180);
    expect(() => buildOrder(orderSchema.parse(input), [])).toThrow();
    expect(() =>
      buildOrder(
        orderSchema.parse({
          ...input,
          items: [{ productId: "p", variantId: "v", quantity: 4 }],
        }),
        products,
      ),
    ).toThrow();
  });
  it("escapes customer text for Telegram HTML", () => {
    expect(escapeHtml("<b>Tom & Ann</b>")).toBe(
      "&lt;b&gt;Tom &amp; Ann&lt;/b&gt;",
    );
  });
});
