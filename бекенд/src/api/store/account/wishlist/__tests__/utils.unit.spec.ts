jest.mock("../../../../catalog/utils", () => ({
  retrieveCatalogProduct: jest.fn(),
}))

import { MedusaError } from "@medusajs/framework/utils"
import { retrieveCatalogProduct } from "../../../../catalog/utils"
import {
  addWishlistItem,
  listWishlistItems,
  listWishlistProductIds,
  removeWishlistItem,
  requireCustomerId,
} from "../utils"

function scopeWith(service: Record<string, jest.Mock>) {
  return { resolve: jest.fn(() => service) } as any
}

describe("wishlist helpers", () => {
  it("requires an authenticated customer", () => {
    expect(requireCustomerId({ auth_context: { actor_id: "cus-1" } } as any)).toBe("cus-1")
    expect(() => requireCustomerId({ auth_context: {} } as any)).toThrow(MedusaError)
  })

  it("returns an existing item without creating a duplicate", async () => {
    const service = { listWishlistItems: jest.fn().mockResolvedValue([{ id: "wish-1" }]), createWishlistItems: jest.fn() }
    await expect(addWishlistItem(scopeWith(service), "cus-1", "prod-1")).resolves.toEqual({ id: "wish-1" })
    expect(service.createWishlistItems).not.toHaveBeenCalled()
  })

  it("creates a new item and recovers a concurrent unique-index race", async () => {
    const created = { listWishlistItems: jest.fn().mockResolvedValue([]), createWishlistItems: jest.fn().mockResolvedValue({ id: "wish-new" }) }
    await expect(addWishlistItem(scopeWith(created), "cus-1", "prod-1")).resolves.toEqual({ id: "wish-new" })

    const raced = {
      listWishlistItems: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "winner" }]),
      createWishlistItems: jest.fn().mockRejectedValue(new Error("unique")),
    }
    await expect(addWishlistItem(scopeWith(raced), "cus-1", "prod-1")).resolves.toEqual({ id: "winner" })
  })

  it("rethrows a create failure when no concurrent winner exists", async () => {
    const service = {
      listWishlistItems: jest.fn().mockResolvedValue([]),
      createWishlistItems: jest.fn().mockRejectedValue(new Error("database down")),
    }
    await expect(addWishlistItem(scopeWith(service), "cus-1", "prod-1")).rejects.toThrow("database down")
  })

  it("removes items and lists only their product ids", async () => {
    const service = {
      deleteWishlistItems: jest.fn().mockResolvedValue({}),
      listWishlistItems: jest.fn().mockResolvedValue([{ product_id: "prod-1" }, { product_id: "prod-2" }]),
    }
    const scope = scopeWith(service)
    await removeWishlistItem(scope, "cus-1", "prod-1")
    await expect(listWishlistProductIds(scope, "cus-1")).resolves.toEqual(["prod-1", "prod-2"])
    expect(service.deleteWishlistItems).toHaveBeenCalledWith({ customer_id: "cus-1", product_id: "prod-1" })
  })

  it("paginates after removing products no longer visible in the catalog", async () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({ id: `wish-${index}`, product_id: `prod-${index}`, created_at: index }))
    const service = { listWishlistItems: jest.fn().mockResolvedValue(rows) }
    ;(retrieveCatalogProduct as jest.Mock).mockImplementation(async (_scope, id) => id === "prod-1" ? null : { id })

    const result = await listWishlistItems(scopeWith(service), "cus-1", 1)
    expect(result.count).toBe(11)
    expect(result.items).toHaveLength(10)
    expect(result.items[0].product_id).toBe("prod-2")
  })
})
