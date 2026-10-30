import { MedusaError } from "@medusajs/framework/utils"

import { verifyYooKassaCredentials } from "../credentials"

describe("YooKassa credential verification", () => {
  it("checks credentials with a read-only provider request", async () => {
    const request = jest.fn().mockResolvedValue({ ok: true, status: 200 })

    await expect(
      verifyYooKassaCredentials(
        { shop_id: "shop-1", secret_key: "secret-1" },
        request
      )
    ).resolves.toBeUndefined()

    expect(request).toHaveBeenCalledWith(
      "https://api.yookassa.ru/v3/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("shop-1:secret-1").toString(
            "base64"
          )}`,
        }),
      })
    )
  })

  it("rejects invalid credentials without exposing them in the error", async () => {
    const request = jest.fn().mockResolvedValue({ ok: false, status: 401 })

    const result = verifyYooKassaCredentials(
      { shop_id: "bad-shop", secret_key: "bad-secret" },
      request
    )

    await expect(result).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
    await expect(result).rejects.not.toThrow(/bad-shop|bad-secret/)
  })
})
