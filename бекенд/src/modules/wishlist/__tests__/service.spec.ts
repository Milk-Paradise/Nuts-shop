import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { WISHLIST_MODULE } from "../index"
import WishlistModuleService from "../service"
import WishlistItem from "../models/wishlist-item"

moduleIntegrationTestRunner<WishlistModuleService>({
  moduleName: WISHLIST_MODULE,
  moduleModels: [WishlistItem],
  resolve: "./src/modules/wishlist",
  testSuite: ({ service }) => {
    describe("WishlistModuleService", () => {
      it("prevents a second row for the same customer/product pair", async () => {
        await service.createWishlistItems({
          customer_id: "cus_dup_1",
          product_id: "prod_dup_1",
        })

        await expect(
          service.createWishlistItems({
            customer_id: "cus_dup_1",
            product_id: "prod_dup_1",
          })
        ).rejects.toThrow()
      })

      it("allows re-adding the same pair after the row was removed", async () => {
        const created = await service.createWishlistItems({
          customer_id: "cus_dup_2",
          product_id: "prod_dup_2",
        })

        await service.deleteWishlistItems(created.id)

        await expect(
          service.createWishlistItems({
            customer_id: "cus_dup_2",
            product_id: "prod_dup_2",
          })
        ).resolves.toEqual(
          expect.objectContaining({
            customer_id: "cus_dup_2",
            product_id: "prod_dup_2",
          })
        )
      })
    })
  },
})
