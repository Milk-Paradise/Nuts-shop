import { saveSellerEmail } from "../seller-notification-channels"

describe("seller notification channels", () => {
  it("stores the seller email in the email channel configuration", async () => {
    const setSellerRecipient = jest.fn().mockResolvedValue({
      email: "seller@example.test",
      telegram: null,
    })
    const container = {
      resolve: jest.fn().mockReturnValue({ setSellerRecipient }),
    }

    await expect(
      saveSellerEmail(container as never, { email: "seller@example.test" })
    ).resolves.toEqual({ email: "seller@example.test", telegram: null })
    expect(setSellerRecipient).toHaveBeenCalledWith(
      "email",
      "seller@example.test"
    )
  })
})
